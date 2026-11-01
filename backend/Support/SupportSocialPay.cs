using System.Text.Json;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

internal static class SupportSocialPay
{
    public static async Task<SupportToolExecutionResult?> CompleteAsync(
        string said,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        BookingPayments payments,
        AuthSettings authSettings,
        VenueRow venue,
        SupportReplyProgress progress,
        CancellationToken cancellationToken)
    {
        if (!SupportSocialSteps.ReadyToPay(said, progress.Socials))
        {
            return null;
        }

        var choice = SupportSocialSteps.Selected(said, progress.Socials);
        if (choice is null || !Guid.TryParse(choice.SocialId, out var socialId) || socialId == Guid.Empty)
        {
            return new SupportToolExecutionResult(new { error = "Choose a public social first." });
        }

        var session = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (session is null)
        {
            return SupportBookingTools.SignInRequired(venue, "Sign in before joining a social.");
        }

        var points = SupportReplyChips.WantsAllPoints(said) ? int.MaxValue : 0;
        var promo = SupportReplyChips.SelectedPromo(said, progress);
        var payLater = said.Contains("pay later", StringComparison.OrdinalIgnoreCase)
            && !said.Contains("pay from this chat", StringComparison.OrdinalIgnoreCase);
        if (payLater)
        {
            return await HoldAsync(repository, venue, session.UserId, socialId, choice, points, promo, cancellationToken);
        }

        if (string.IsNullOrWhiteSpace(authSettings.FrontendOrigin))
        {
            return new SupportToolExecutionResult(new { error = "Card payments are not configured yet." });
        }

        var origin = authSettings.FrontendOrigin.TrimEnd('/');
        var page = $"/{venue.Slug}/social/{socialId:D}";
        var checkout = await payments.SocialCheckoutAsync(
            venue.Id,
            socialId,
            session.UserId,
            venue.Currency,
            points,
            promo,
            $"{origin}{page}?checkout=success",
            $"{origin}{page}?checkout=cancel",
            cancellationToken,
            waitlist: choice.Full);
        if (checkout.Error is not null)
        {
            return new SupportToolExecutionResult(new { error = checkout.Error });
        }

        return Card(checkout, page, choice, promo);
    }

    public static string? Error(SupportToolExecutionResult result)
    {
        var json = JsonSerializer.SerializeToElement(result.Response);
        return json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("error", out var error)
            && error.ValueKind == JsonValueKind.String
                ? error.GetString()
                : null;
    }

    private static async Task<SupportToolExecutionResult> HoldAsync(
        BookingRepository repository,
        VenueRow venue,
        Guid userId,
        Guid socialId,
        SocialChoice choice,
        int points,
        string? promo,
        CancellationToken cancellationToken)
    {
        if (choice.Full || choice.StartUtc is null || choice.StartUtc <= DateTime.UtcNow.AddHours(24))
        {
            return new SupportToolExecutionResult(new { error = "This social starts within 24 hours, so it must be paid now." });
        }

        var hold = await repository.BeginPublicSocialCheckoutAsync(
            venue.Id,
            socialId,
            userId,
            venue.Currency,
            points,
            promo,
            cancellationToken,
            choice.StartUtc.Value.AddHours(-24));
        if (hold.Error is not null)
        {
            return new SupportToolExecutionResult(new { error = hold.Error });
        }

        var (dateLabel, timeLabel) = When(choice);
        return new SupportToolExecutionResult(
            new
            {
                socialId,
                registrationId = hold.RegistrationId,
                needsPayment = hold.NeedsPayment && !hold.AlreadyJoined,
                alreadyJoined = hold.AlreadyJoined,
                status = hold.Status,
            },
            [
                new SupportChatAction(
                    Kind: "my_bookings_link",
                    Label: hold.NeedsPayment ? "Pay in My Bookings" : "View this social",
                    Href: $"/{venue.Slug}/social/{socialId:D}",
                    SocialId: socialId.ToString("D"),
                    CourtSummary: "Drop-in social",
                    DateLabel: dateLabel,
                    TimeLabel: timeLabel,
                    Currency: hold.Currency,
                    Subtotal: hold.Subtotal,
                    DiscountAmount: hold.DiscountAmount,
                    PointsValue: hold.PointsValue,
                    CashAmount: hold.Amount,
                    PromoCode: promo,
                    CanPayLater: hold.NeedsPayment),
            ]);
    }

    private static SupportToolExecutionResult Card(SocialCheckoutResponse checkout, string page, SocialChoice choice, string? promo)
    {
        var (dateLabel, timeLabel) = When(choice);
        var pay = new SupportChatAction(
            Kind: "my_bookings_link",
            Label: checkout.CheckoutUrl is null ? "View this social" : "Pay in My Bookings",
            Href: page,
            SocialId: checkout.RegistrationId == Guid.Empty ? null : choice.SocialId,
            CourtSummary: choice.Full ? "Drop-in social waitlist" : "Drop-in social",
            DateLabel: dateLabel,
            TimeLabel: timeLabel,
            Currency: checkout.Currency,
            Subtotal: checkout.Subtotal,
            DiscountAmount: checkout.DiscountAmount,
            PointsValue: checkout.PointsValue,
            CashAmount: checkout.Amount,
            PromoCode: promo);
        var summary = new
        {
            socialId = choice.SocialId,
            registrationId = checkout.RegistrationId,
            needsPayment = !string.IsNullOrWhiteSpace(checkout.CheckoutUrl),
            status = checkout.Status,
        };
        if (string.IsNullOrWhiteSpace(checkout.CheckoutUrl))
        {
            return new SupportToolExecutionResult(summary, [pay]);
        }

        var stripe = new SupportChatAction(
            Kind: "stripe_checkout",
            Label: "Pay now with Stripe",
            Href: checkout.CheckoutUrl,
            SocialId: choice.SocialId,
            CourtSummary: pay.CourtSummary,
            DateLabel: dateLabel,
            TimeLabel: timeLabel,
            Currency: checkout.Currency,
            Subtotal: checkout.Subtotal,
            DiscountAmount: checkout.DiscountAmount,
            PointsValue: checkout.PointsValue,
            CashAmount: checkout.Amount,
            PromoCode: promo);
        return new SupportToolExecutionResult(summary, [stripe, pay]);
    }

    private static (string? DateLabel, string? TimeLabel) When(SocialChoice choice)
    {
        var parts = choice.Label.Split(" · ", 3, StringSplitOptions.TrimEntries);
        return (parts.ElementAtOrDefault(0), parts.ElementAtOrDefault(1));
    }
}
