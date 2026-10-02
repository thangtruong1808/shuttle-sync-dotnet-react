using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this WebApplication app)
    {
        var me = app.MapGroup("/api/me").RequireAuthorization();
        me.MapGet("/bookings", BookingsAsync);
        me.MapGet("/bookings/{id:guid}", BookingAsync);
        me.MapPost("/bookings/{id:guid}/cancel", CancelAsync);
        me.MapGet("/rewards", RewardsAsync);
        me.MapGet("/payments", PaymentsAsync);
    }

    private static async Task<IResult> BookingsAsync(
        HttpContext http,
        string? status,
        int? page,
        int? pageSize,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var filter = status is "past" or "cancelled" ? status : "upcoming";
        var (pageNumber, size, offset) = Page(page, pageSize);
        var (items, total) = await repository.ListBookingsAsync(userId.Value, filter, offset, size, cancellationToken);
        var now = DateTime.UtcNow;
        return Results.Ok(new
        {
            items = items.Select(item => new
            {
                id = item.Id,
                venueName = item.VenueName,
                venueSlug = item.VenueSlug,
                courtName = item.CourtName,
                courtNumber = item.CourtNumber,
                startTime = VenueClock.AsUtc(item.StartTime),
                endTime = VenueClock.AsUtc(item.EndTime),
                timeZone = item.TimeZone,
                currency = item.Currency,
                status = item.Status,
                totalAmount = item.TotalAmount,
                canCancel = item.Status is "pending" or "confirmed" && item.StartTime > now,
            }),
            page = pageNumber,
            pageSize = size,
            total,
        });
    }

    private static async Task<IResult> BookingAsync(
        Guid id,
        HttpContext http,
        AuthRepository authRepository,
        PaymentRepository payments,
        BookingPayments bookingPayments,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        try
        {
            await bookingPayments.SyncAsync(userId.Value, id, cancellationToken);
        }
        catch (Stripe.StripeException)
        {
            // The stored status is still returned when Stripe cannot be reached.
        }

        var booking = await payments.FindOwnedPaymentAsync(userId.Value, id, cancellationToken);
        if (booking is null)
        {
            return Results.NotFound();
        }

        return Results.Ok(new
        {
            id = booking.Id,
            status = booking.Status,
            paymentStatus = booking.PaymentStatus,
            currency = booking.Currency,
            cashAmount = booking.TotalAmount,
            pointsRedeemed = booking.PointsRedeemed,
            pointsValue = booking.PointsValue,
        });
    }

    private static async Task<IResult> CancelAsync(
        Guid id,
        HttpContext http,
        AuthRepository authRepository,
        BookingPayments bookingPayments,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var result = await bookingPayments.CancelAsync(userId.Value, id, cancellationToken);
        if (result.Error is not null)
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]>
                {
                    ["form"] = [result.Error],
                },
            }, statusCode: result.StatusCode);
        }

        return Results.Ok(new
        {
            refundAmount = result.RefundAmount,
            feePercent = result.FeePercent,
            pointsRestored = result.PointsRestored,
            currency = result.Currency,
        });
    }

    private static async Task<IResult> RewardsAsync(
        HttpContext http,
        int? page,
        int? pageSize,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var user = await authRepository.FindUserByIdAsync(userId.Value, cancellationToken);
        if (user is null)
        {
            return SignInAgain();
        }

        var (pageNumber, size, offset) = Page(page, pageSize);
        var (items, total) = await repository.ListRewardsAsync(userId.Value, offset, size, cancellationToken);
        return Results.Ok(new
        {
            balance = user.RewardPoints,
            items = items.Select(item => new
            {
                id = item.Id,
                points = item.Points,
                awardedAt = VenueClock.AsUtc(item.AwardedAt),
                venueName = item.VenueName,
                timeZone = item.TimeZone,
                courtName = item.CourtName,
                startTime = VenueClock.AsUtc(item.StartTime),
                endTime = VenueClock.AsUtc(item.EndTime),
            }),
            page = pageNumber,
            pageSize = size,
            total,
        });
    }

    private static async Task<IResult> PaymentsAsync(
        HttpContext http,
        int? page,
        int? pageSize,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var (pageNumber, size, offset) = Page(page, pageSize);
        var (items, total) = await repository.ListPaymentsAsync(userId.Value, offset, size, cancellationToken);
        return Results.Ok(new
        {
            items = items.Select(item => new
            {
                id = item.Id,
                kind = item.Kind,
                amount = item.Amount,
                currency = item.Currency,
                status = item.Status,
                occurredAt = VenueClock.AsUtc(item.OccurredAt),
                venueName = item.VenueName,
            }),
            page = pageNumber,
            pageSize = size,
            total,
        });
    }

    private static async Task<Guid?> RequireUserAsync(
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, repository, cancellationToken);
        return current?.UserId;
    }

    private static (int Page, int PageSize, int Offset) Page(int? page, int? pageSize)
    {
        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is null or < 1 ? 20 : Math.Min(pageSize.Value, 50);
        return (pageNumber, size, (pageNumber - 1) * size);
    }

    private static IResult SignInAgain() =>
        Results.Json(new
        {
            errors = new Dictionary<string, string[]> { ["form"] = ["Sign in again."] },
        }, statusCode: StatusCodes.Status401Unauthorized);
}
