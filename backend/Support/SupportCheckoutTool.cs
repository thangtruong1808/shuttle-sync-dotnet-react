using System.Text.Json;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

using static SupportDiscoveryShared;

internal static class SupportCheckoutTool
{
    private static readonly string[] PaymentMethods = ["Card", "Apple Pay", "Google Pay", "BECS Direct Debit", "PayTo"];

    public static async Task<SupportToolExecutionResult> CreateAsync(
        JsonElement args,
        HttpContext http,
        AuthRepository authRepository,
        BookingPayments payments,
        AuthSettings authSettings,
        VenueRow? venue,
        CancellationToken cancellationToken)
    {
        var session = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (session is null)
        {
            return SupportBookingTools.SignInRequired(venue, "Sign in before paying.");
        }

        if (venue is null)
        {
            return new SupportToolExecutionResult(new { error = "Choose a venue before paying." });
        }

        if (string.IsNullOrWhiteSpace(authSettings.FrontendOrigin))
        {
            return new SupportToolExecutionResult(new { error = "Card payments are not configured yet." });
        }

        var groupId = ReadGuid(args, "groupId");
        var sessionId = ReadGuid(args, "sessionId");
        if (groupId is null && sessionId is null)
        {
            return new SupportToolExecutionResult(new { error = "Choose the booking to pay." });
        }

        var origin = authSettings.FrontendOrigin.TrimEnd('/');
        var points = Math.Max(0, ReadInt(args, "pointsToRedeem") ?? 0);
        var promotionCode = ReadString(args, "promotionCode");
        CheckoutResponse result;
        if (groupId is Guid group)
        {
            result = await payments.CheckoutGroupAsync(
                venue.Id,
                group,
                session.UserId,
                ReadGuids(args, "bookingIds"),
                points,
                promotionCode,
                $"{origin}/{venue.Slug}/book/group/{group}?checkout=success",
                $"{origin}/{venue.Slug}/book/group/{group}?checkout=cancel",
                cancellationToken);
        }
        else
        {
            var courtSession = sessionId!.Value;
            result = await payments.CheckoutAsync(
                venue.Id,
                courtSession,
                session.UserId,
                points,
                promotionCode,
                $"{origin}/{venue.Slug}/book/{courtSession}?checkout=success",
                $"{origin}/{venue.Slug}/book/{courtSession}?checkout=cancel",
                cancellationToken);
        }

        if (result.Error is not null)
        {
            return new SupportToolExecutionResult(new { error = result.Error });
        }

        var paidInFull = result.CashAmount <= 0;
        var checkoutUrl = paidInFull || string.IsNullOrWhiteSpace(result.CheckoutUrl) ? null : result.CheckoutUrl;
        var summary = new
        {
            bookingId = result.BookingId,
            groupId,
            sessionId,
            status = result.Status,
            currency = result.Currency,
            subtotal = result.Subtotal,
            discountAmount = result.DiscountAmount,
            pointsRedeemed = result.PointsRedeemed,
            pointsValue = result.PointsValue,
            cashAmount = result.CashAmount,
            promotionCode,
            checkoutUrl,
            paymentMethods = checkoutUrl is null ? Array.Empty<string>() : PaymentMethods,
        };
        var action = checkoutUrl is null
            ? new SupportChatAction(
                Kind: "my_bookings_link",
                Label: "View in My Bookings",
                Href: "/profile/bookings",
                GroupId: groupId?.ToString("D"),
                SessionId: sessionId?.ToString("D"),
                Currency: result.Currency,
                Subtotal: result.Subtotal,
                DiscountAmount: result.DiscountAmount,
                PointsValue: result.PointsValue,
                CashAmount: result.CashAmount,
                PromoCode: promotionCode)
            : new SupportChatAction(
                Kind: "stripe_checkout",
                Label: "Pay now with Stripe",
                Href: result.CheckoutUrl,
                GroupId: groupId?.ToString("D"),
                SessionId: sessionId?.ToString("D"),
                Currency: result.Currency,
                Subtotal: result.Subtotal,
                DiscountAmount: result.DiscountAmount,
                PointsValue: result.PointsValue,
                CashAmount: result.CashAmount,
                PromoCode: promotionCode);
        return new SupportToolExecutionResult(summary, [action]);
    }

    private static Guid? ReadGuid(JsonElement args, string name)
    {
        var raw = ReadString(args, name);
        return Guid.TryParse(raw, out var id) && id != Guid.Empty ? id : null;
    }

    private static Guid[] ReadGuids(JsonElement args, string name)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return value.EnumerateArray()
            .Select(item => item.ValueKind == JsonValueKind.String && Guid.TryParse(item.GetString(), out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .Distinct()
            .ToArray();
    }
}
