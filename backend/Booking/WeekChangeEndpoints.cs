using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public static class WeekChangeEndpoints
{
    public static void Map(RouteGroupBuilder me)
    {
        me.MapGet("/holds/{groupId:guid}/week-availability", AvailabilityAsync);
        me.MapGet("/holds/{groupId:guid}/open-times", OpenTimesAsync);
        me.MapPost("/holds/{groupId:guid}/week", ApplyAsync);
        me.MapPost("/week-copy", CopyAsync);
    }

    private static async Task<IResult> AvailabilityAsync(
        Guid groupId,
        string? start,
        HttpContext http,
        AuthRepository auth,
        BookingRepository bookings,
        CancellationToken cancellationToken)
    {
        var userId = await UserIdAsync(http, auth, cancellationToken);
        if (userId is null) return SignIn();
        if (!DateTimeOffset.TryParse(start, out var current)) return Form("That week was not found.");
        var result = await bookings.WeekAvailabilityAsync(userId.Value, groupId, current.UtcDateTime, cancellationToken);
        if (result is null) return Form("That week was not found.", StatusCodes.Status404NotFound);
        return Results.Ok(new
        {
            allCourtsBooked = result.AllCourtsBooked,
            courts = result.Courts.Select(court => new { id = court.Id, courtName = court.CourtName, yours = court.Yours, free = court.Free }),
        });
    }

    private static async Task<IResult> OpenTimesAsync(
        Guid groupId,
        string? start,
        string? date,
        string? courts,
        int? duration,
        HttpContext http,
        AuthRepository auth,
        BookingRepository bookings,
        CancellationToken cancellationToken)
    {
        var userId = await UserIdAsync(http, auth, cancellationToken);
        if (userId is null) return SignIn();
        if (!DateTimeOffset.TryParse(start, out var current)) return Form("That week was not found.");
        var ids = (courts ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToArray();
        var result = await bookings.OpenTimesAsync(userId.Value, groupId, current.UtcDateTime, date, ids, duration, cancellationToken);
        if (result is null) return Form("That week was not found.", StatusCodes.Status404NotFound);
        return Results.Ok(new { times = result.Times, heldForRecurring = result.HeldForRecurring });
    }

    private static async Task<IResult> ApplyAsync(
        Guid groupId,
        ApplyWeekBody body,
        HttpContext http,
        AuthRepository auth,
        BookingRepository bookings,
        CancellationToken cancellationToken)
    {
        var userId = await UserIdAsync(http, auth, cancellationToken);
        if (userId is null) return SignIn();
        if (!DateTimeOffset.TryParse(body.StartTime, out var current)) return Form("That week was not found.");
        var result = await bookings.ApplyWeekAsync(
            userId.Value,
            groupId,
            current.UtcDateTime,
            body.Date,
            body.Start,
            body.End,
            body.CourtIds ?? [],
            body.AcceptPriceIncrease,
            http.Connection.RemoteIpAddress?.ToString(),
            cancellationToken);
        if (!result.Ok)
        {
            return Results.Json(new
            {
                ok = false,
                code = result.Code,
                fallback = result.Fallback,
                facts = result.Facts,
                errors = new Dictionary<string, string[]> { ["form"] = [result.Fallback] },
            }, statusCode: StatusCodes.Status409Conflict);
        }

        return Results.Ok(new { ok = true, addedBookingIds = result.AddedBookingIds, topUpAmount = result.TopUpAmount, payNow = result.PayNow, payBookingIds = result.PayBookingIds });
    }

    private static async Task<IResult> CopyAsync(
        WeekCopyBody body,
        HttpContext http,
        AuthRepository auth,
        WeekChangeCopy copy,
        CancellationToken cancellationToken)
    {
        var userId = await UserIdAsync(http, auth, cancellationToken);
        if (userId is null) return SignIn();
        var facts = WeekChangeText.Facts(body.Code ?? "", body.Courts ?? [], body.When ?? "", body.Alternatives ?? [], null);
        var phrased = await copy.PhraseAsync(userId.Value, facts, cancellationToken);
        return Results.Ok(new { message = phrased.Message, source = phrased.Source });
    }

    private static async Task<Guid?> UserIdAsync(HttpContext http, AuthRepository auth, CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        return current?.UserId;
    }

    private static IResult Form(string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new { errors = new Dictionary<string, string[]> { ["form"] = [message] } }, statusCode: status);

    private static IResult SignIn() => Form("Sign in again.", StatusCodes.Status401Unauthorized);

    private sealed record ApplyWeekBody(string? StartTime, string? Date, string? Start, string? End, Guid[]? CourtIds, bool AcceptPriceIncrease);

    private sealed record WeekCopyBody(string? Code, string[]? Courts, string? When, WeekSlotFact[]? Alternatives);
}
