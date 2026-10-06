using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this WebApplication app)
    {
        var me = app.MapGroup("/api/me").RequireAuthorization();
        me.MapGet("/bookings", BookingsAsync);
        me.MapGet("/court-weeks", CourtWeeksAsync);
        me.MapGet("/unpaid-holds", UnpaidHoldsAsync);
        me.MapPut("/holds/{groupId:guid}/repeat", SetRepeatAsync);
        me.MapPost("/holds/{groupId:guid}/delete-unpaid", DeleteUnpaidAsync);
        me.MapPost("/holds/{groupId:guid}/delete-series", DeleteSeriesAsync);
        me.MapPost("/holds/{groupId:guid}/move", MoveHoldAsync);
        me.MapGet("/friend-spots", FriendSpotsAsync);
        me.MapGet("/bookings/{id:guid}", BookingAsync);
        me.MapPost("/bookings/{id:guid}/cancel", CancelAsync);
        me.MapPut("/social-friends/{id:guid}", RenameFriendAsync);
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
        BookingPayments payments,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        await payments.RefundStartedWaitlistsAsync(cancellationToken);
        await payments.ReleaseExpiredCourtHoldsAsync(cancellationToken);
        var filter = status is "past" or "cancelled" ? status : "upcoming";
        var (pageNumber, size, offset) = Page(page, pageSize);
        var (items, total) = await repository.ListBookingsAsync(userId.Value, filter, offset, size, cancellationToken);
        var friends = await repository.ListBookingFriendsAsync(userId.Value, items.Select(item => item.Id).ToArray(), cancellationToken);
        var friendsByRegistration = friends.GroupBy(friend => friend.RegistrationId).ToDictionary(group => group.Key, group => group.ToArray());
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
                canCancel = (item.Status is "pending" or "confirmed" or "waitlist") && item.StartTime > now,
                socialId = item.SocialId,
                groupId = item.GroupId,
                friends = (friendsByRegistration.TryGetValue(item.Id, out var mine) ? mine : Array.Empty<FriendBookingRow>()).Select(friend => new
                {
                    id = friend.Id,
                    name = friend.DisplayName,
                    status = friend.Status,
                    amount = friend.Amount,
                    courtName = friend.CourtName,
                    canCancel = friend.Status == "confirmed" && friend.StartTime > now,
                }),
            }),
            page = pageNumber,
            pageSize = size,
            total,
        });
    }

    private static async Task<IResult> CourtWeeksAsync(
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        BookingPayments payments,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        await payments.ReleaseExpiredCourtHoldsAsync(cancellationToken);
        var rows = await repository.ListCourtWeeksAsync(userId.Value, cancellationToken);
        return Results.Ok(new
        {
            weeks = rows.Select(row => new
            {
                bookingId = row.BookingId,
                groupId = row.GroupId,
                status = row.Status,
                price = row.Price,
                venueName = row.VenueName,
                venueSlug = row.VenueSlug,
                timeZone = row.TimeZone,
                currency = row.Currency,
                courtId = row.CourtId,
                courtName = row.CourtName,
                courtNumber = row.CourtNumber,
                startTime = VenueClock.AsUtc(row.StartTime),
                endTime = VenueClock.AsUtc(row.EndTime),
                seriesWeeks = row.SeriesWeeks,
                repeatHold = row.RepeatHold == 1,
                repeatNote = row.RepeatNote,
            }),
        });
    }

    private static async Task<IResult> UnpaidHoldsAsync(
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var rows = await repository.ListUnpaidHoldsAsync(userId.Value, cancellationToken);
        return Results.Ok(new
        {
            items = rows.Select(row => new
            {
                groupId = row.GroupId,
                venueName = row.VenueName,
                venueSlug = row.VenueSlug,
                timeZone = row.TimeZone,
                startTime = VenueClock.AsUtc(row.StartTime),
                courtCount = row.CourtCount,
            }),
        });
    }

    private static async Task<IResult> DeleteUnpaidAsync(
        Guid groupId,
        DeleteBookingsBody? body,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var error = await repository.DeleteUnpaidBookingsAsync(userId.Value, groupId, body?.BookingIds, cancellationToken);
        if (error is not null)
        {
            return Form(error, StatusCodes.Status409Conflict);
        }

        return Results.Ok(new { deleted = true });
    }

    private static async Task<IResult> DeleteSeriesAsync(
        Guid groupId,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        BookingPayments payments,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var unpaid = await repository.DeleteUnpaidBookingsAsync(userId.Value, groupId, null, cancellationToken);
        if (unpaid is not null)
        {
            return Form(unpaid, StatusCodes.Status409Conflict);
        }

        var confirmed = await repository.ListFutureConfirmedAsync(userId.Value, groupId, cancellationToken);
        foreach (var bookingId in confirmed)
        {
            var result = await payments.CancelAsync(userId.Value, bookingId, cancellationToken);
            if (result.Error is not null)
            {
                return Form(result.Error, result.StatusCode);
            }
        }

        return Results.Ok(new { deleted = true });
    }

    private static async Task<IResult> MoveHoldAsync(
        Guid groupId,
        MoveSessionsBody body,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        if (!DateTimeOffset.TryParse(body.StartTime, out var current))
        {
            return Form("That session was not found.", StatusCodes.Status400BadRequest);
        }

        var error = await repository.MoveSessionsAsync(
            userId.Value,
            groupId,
            current.UtcDateTime,
            body.BookingId,
            body.Date,
            body.Start,
            body.End,
            cancellationToken);
        if (error is not null)
        {
            return Form(error, StatusCodes.Status409Conflict);
        }

        return Results.Ok(new { moved = true });
    }

    private static async Task<IResult> SetRepeatAsync(
        Guid groupId,
        RepeatHoldBody body,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        BookingPayments payments,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        await payments.ReleaseExpiredCourtHoldsAsync(cancellationToken);
        var saved = await repository.SetRepeatHoldAsync(userId.Value, groupId, body.Enabled, cancellationToken);
        if (!saved.Ok)
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]>
                {
                    ["form"] = [saved.Message ?? "This repeat could not be saved."],
                },
            }, statusCode: saved.Message == "That booking was not found." ? StatusCodes.Status404NotFound : StatusCodes.Status400BadRequest);
        }

        return Results.Ok(new { repeatHold = body.Enabled, note = saved.Message });
    }

    private static async Task<IResult> FriendSpotsAsync(
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
        var (items, total) = await repository.ListFriendSpotsAsync(userId.Value, filter, offset, size, cancellationToken);
        var activeSocials = items.Length == 0
            ? []
            : await repository.ListMySocialStatesAsync(userId.Value, items.Select(item => item.SocialId).Distinct().ToArray(), cancellationToken);
        var stillIn = activeSocials.Select(row => row.SocialId).ToHashSet();
        var now = DateTime.UtcNow;
        return Results.Ok(new
        {
            items = items.Select(item => new
            {
                id = item.Id,
                name = item.DisplayName,
                status = item.Status,
                amount = item.Amount,
                courtName = item.CourtName,
                courtNumber = item.CourtNumber,
                venueName = item.VenueName,
                venueSlug = item.VenueSlug,
                timeZone = item.TimeZone,
                currency = item.Currency,
                socialId = item.SocialId,
                startTime = VenueClock.AsUtc(item.StartTime),
                endTime = VenueClock.AsUtc(item.EndTime),
                youLeft = !stillIn.Contains(item.SocialId),
                canCancel = (item.Status is "confirmed" or "waitlist") && item.StartTime > now,
                canRename = (item.Status is "pending" or "confirmed" or "waitlist") && item.StartTime > now,
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
        if (result.StatusCode == StatusCodes.Status404NotFound)
        {
            result = await bookingPayments.CancelSocialAsync(userId.Value, id, cancellationToken);
        }

        if (result.StatusCode == StatusCodes.Status404NotFound)
        {
            result = await bookingPayments.CancelFriendAsync(userId.Value, id, cancellationToken);
        }
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

        await repository.AwardEndedSocialIncentivesAsync(cancellationToken);
        var user = await authRepository.FindUserByIdAsync(userId.Value, cancellationToken);
        if (user is null)
        {
            return SignInAgain();
        }

        var pageNumber = page is null or < 1 ? 1 : page.Value;
        var size = pageSize is 10 or 20 or 50 ? pageSize.Value : 20;
        var (items, total) = await repository.ListRewardsAsync(userId.Value, (pageNumber - 1) * size, size, cancellationToken);
        var pending = await repository.ListPendingRewardsAsync(userId.Value, cancellationToken);
        return Results.Ok(new
        {
            balance = user.RewardPoints,
            pending = pending.Sum(item => item.Points),
            pendingItems = pending.Select(item => new
            {
                id = item.Id,
                kind = item.Kind,
                points = item.Points,
                venueName = item.VenueName,
                timeZone = item.TimeZone,
                courtName = item.CourtName,
                startTime = VenueClock.AsUtc(item.StartTime),
                endTime = VenueClock.AsUtc(item.EndTime),
            }),
            items = items.Select(item => new
            {
                id = item.Id,
                kind = item.Kind,
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

    private static async Task<IResult> RenameFriendAsync(
        Guid id,
        RenameFriendBody body,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var userId = await RequireUserAsync(http, authRepository, cancellationToken);
        if (userId is null)
        {
            return SignInAgain();
        }

        var name = body.Name?.Trim() ?? "";
        if (name.Length == 0 || name.Length > 80)
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]> { ["form"] = ["Enter a name of 1 to 80 characters."] },
            }, statusCode: StatusCodes.Status400BadRequest);
        }

        var saved = await repository.RenameSocialFriendAsync(userId.Value, id, name, cancellationToken);
        if (!saved)
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]> { ["form"] = ["This friend's name can no longer be changed."] },
            }, statusCode: StatusCodes.Status409Conflict);
        }

        return Results.Ok(new { id, name });
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

    private sealed record RenameFriendBody(string? Name);
    private sealed record RepeatHoldBody(bool Enabled);
    private sealed record DeleteBookingsBody(Guid[]? BookingIds);
    private sealed record MoveSessionsBody(string? StartTime, Guid? BookingId, string? Date, string? Start, string? End);

    private static IResult Form(string message, int status) =>
        Results.Json(new
        {
            errors = new Dictionary<string, string[]> { ["form"] = [message] },
        }, statusCode: status);

    private static IResult SignInAgain() =>
        Results.Json(new
        {
            errors = new Dictionary<string, string[]> { ["form"] = ["Sign in again."] },
        }, statusCode: StatusCodes.Status401Unauthorized);
}
