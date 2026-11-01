using System.Text.Json;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

using static SupportDiscoveryShared;

internal static class SupportQuotePreview
{
    public static async Task<SupportToolExecutionResult> PreviewAsync(
        JsonElement args,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken,
        bool redeemAllPoints = false)
    {
        if (venue is null || !TryGetZone(venue.TimeZone, out var zone))
        {
            return new SupportToolExecutionResult(new { error = "Venue is not available." });
        }

        var date = ResolveDate(ReadString(args, "date") ?? pageDate, zone);
        var startRaw = ReadString(args, "startTime") ?? "18:00";
        var endRaw = ReadString(args, "endTime") ?? "19:00";
        if (!TryParseClockFlexible(startRaw, out var startClock) || !TryParseClockFlexible(endRaw, out var endClock))
        {
            return new SupportToolExecutionResult(new { error = "Invalid start or end time format." });
        }

        var courtCount = Math.Clamp(ReadInt(args, "courtCount") ?? 1, 1, 16);
        var weeks = Math.Clamp(ReadInt(args, "weeks") ?? 1, 1, 12);
        var promoCode = ReadString(args, "promotionCode")?.Trim().ToUpperInvariant();
        var requestedPoints = Math.Max(0, ReadInt(args, "pointsToRedeem") ?? 0);
        if (requestedPoints == 0 && redeemAllPoints)
        {
            requestedPoints = int.MaxValue;
        }

        var startLocal = date.ToDateTime(startClock);
        var endLocal = date.ToDateTime(endClock);
        if (endLocal <= startLocal)
        {
            endLocal = endLocal.AddDays(1);
        }

        var startUtc = TimeZoneInfo.ConvertTimeToUtc(startLocal, zone);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(endLocal, zone);

        var rates = await repository.ListRateWindowsAsync(venue.Id, cancellationToken);
        decimal singleCourtTotal = 0;
        for (var week = 0; week < weeks; week++)
        {
            var weekStart = startUtc;
            var weekEnd = endUtc;
            if (week > 0 && !VenueClock.TryShiftDays(venue.TimeZone, startUtc, endUtc, 7 * week, out weekStart, out weekEnd))
            {
                continue;
            }

            singleCourtTotal += CourtRates.Quote(venue.TimeZone, venue.HourlyRate, weekStart, weekEnd, rates);
        }

        var subtotal = decimal.Round(singleCourtTotal * courtCount, 2, MidpointRounding.AwayFromZero);
        decimal discountAmount = 0;
        string? appliedPromo = null;
        string? promoNote = null;

        if (!string.IsNullOrWhiteSpace(promoCode))
        {
            var activePromos = await repository.ListPromotionsAsync(venue.Id, cancellationToken);
            var matched = activePromos.FirstOrDefault(promo => promo.Code.Equals(promoCode, StringComparison.OrdinalIgnoreCase));
            if (matched is not null)
            {
                appliedPromo = matched.Code;
                discountAmount = matched.DiscountType.Equals("percent", StringComparison.OrdinalIgnoreCase)
                    ? decimal.Round(subtotal * (matched.DiscountValue / 100m), 2, MidpointRounding.AwayFromZero)
                    : Math.Min(subtotal, matched.DiscountValue);
                discountAmount = Math.Clamp(discountAmount, 0m, subtotal);
            }
            else
            {
                promoNote = $"Promotion code '{promoCode}' was not found or is not active at {venue.Name}.";
            }
        }

        var afterPromo = Math.Max(0m, subtotal - discountAmount);
        var session = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        var user = session is null ? null : await authRepository.FindUserByIdAsync(session.UserId, cancellationToken);
        var availablePoints = user?.RewardPoints ?? 0;
        var quoted = PaymentRepository.Quote(requestedPoints, availablePoints, Math.Max(1, venue.PointsPerDollar), afterPromo);
        var notes = new[] { promoNote, quoted.Error }.Where(note => !string.IsNullOrWhiteSpace(note)).ToArray();

        return new SupportToolExecutionResult(new
        {
            currency = venue.Currency,
            courtCount,
            weeks,
            subtotal,
            appliedPromotionCode = appliedPromo,
            promotionNote = promoNote,
            discountAmount,
            pointsRedeemed = quoted.Points,
            pointsValue = quoted.Value,
            cashAmount = quoted.Cash,
            quoteNote = notes.Length == 0 ? null : string.Join(" ", notes),
            cashAccepted = quoted.Error is null,
            moreThan24HoursAway = startUtc > DateTime.UtcNow.AddHours(24),
        });
    }
}
