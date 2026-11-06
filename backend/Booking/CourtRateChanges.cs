using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public sealed class RateChangeResult
{
    public decimal Refunded { get; init; }
    public string? RefundError { get; init; }
    public HoldPriceChange[] HoldChanges { get; init; } = [];
}

public static class CourtRateChanges
{
    public static async Task<RateChangeResult> SyncGroupAsync(
        BookingRepository bookings,
        BookingPayments payments,
        Guid venueId,
        Guid userId,
        Guid groupId,
        CancellationToken cancellationToken)
    {
        var holds = await bookings.RefreshGroupPricesAsync(venueId, userId, groupId, cancellationToken);
        var settled = await RefundDropsAsync(bookings, payments, venueId, groupId, userId, cancellationToken);
        return new RateChangeResult { Refunded = settled.Refunded, RefundError = settled.Error, HoldChanges = holds };
    }

    public static Task<(decimal Refunded, string? Error)> RefundDropsAsync(
        BookingRepository bookings,
        BookingPayments payments,
        Guid venueId,
        CancellationToken cancellationToken) =>
        RefundDropsAsync(bookings, payments, venueId, null, null, cancellationToken);

    public static async Task<(decimal Refunded, string? Error)> RefundDropsAsync(
        BookingRepository bookings,
        BookingPayments payments,
        Guid venueId,
        Guid? groupId,
        Guid? userId,
        CancellationToken cancellationToken)
    {
        var rows = await bookings.ListConfirmedCourtPricesAsync(venueId, groupId, userId, cancellationToken);
        if (rows.Length == 0)
        {
            return (0, null);
        }

        var windows = await bookings.ListRateWindowsAsync(venueId, cancellationToken);
        decimal refunded = 0;
        foreach (var row in rows)
        {
            var quote = CourtRates.Quote(row.TimeZone, row.HourlyRate, row.StartTime, row.EndTime, windows);
            if (quote <= 0 || quote >= row.SubtotalAmount - 0.009m)
            {
                continue;
            }

            var discount = Math.Min(row.DiscountAmount, quote);
            var points = Math.Min(row.PointsValue, Math.Max(0, quote - discount));
            var expectedCash = decimal.Round(Math.Max(0, quote - discount - points), 2, MidpointRounding.AwayFromZero);
            var refundCash = decimal.Round(Math.Max(0, row.TotalAmount - expectedCash), 2, MidpointRounding.AwayFromZero);
            if (refundCash > 0.009m)
            {
                var key = $"rate-refund-{row.BookingId:N}-{(int)decimal.Round(row.SubtotalAmount * 100m, 0)}-{(int)decimal.Round(quote * 100m, 0)}";
                var error = await payments.RefundCourtDifferenceAsync(row.UserId, row.BookingId, refundCash, key, cancellationToken);
                if (error is not null)
                {
                    return (refunded, error);
                }

                refunded += refundCash;
            }

            await bookings.SaveConfirmedCourtPriceAsync(row.BookingId, row.SessionId, quote, discount, points, expectedCash, cancellationToken);
        }

        return (refunded, null);
    }
}
