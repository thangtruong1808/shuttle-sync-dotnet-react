using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;
using ShuttleSync.Api.Support;

namespace ShuttleSync.Api.Booking;

public static class RecommendationEndpoints
{
    public static async Task<IResult> ListPlayersAsync(
        Guid? venueId,
        HttpContext http,
        AuthRepository auth,
        DashboardRepository dashboard,
        RecommendationRepository recommendations,
        CancellationToken cancellationToken)
    {
        var actor = await StaffAsync(http, auth, cancellationToken);
        if (actor.Error is not null) return actor.Error;
        if (venueId is null || venueId == Guid.Empty) return Form("Choose a venue.");
        if (!await dashboard.CanAccessVenueAsync(actor.UserId, actor.Role, venueId.Value, cancellationToken)) return Missing();
        var players = await recommendations.ListPlayersAsync(venueId.Value, cancellationToken);
        return Results.Ok(players.Select(player => new
        {
            id = player.Id,
            email = player.Email,
            displayName = player.DisplayName,
            reason = player.Reason,
        }));
    }

    public static async Task<IResult> WriteAsync(
        WriteRecommendationBody body,
        HttpContext http,
        AuthRepository auth,
        DashboardRepository dashboard,
        RecommendationRepository recommendations,
        ComebackCopy copy,
        CancellationToken cancellationToken)
    {
        var actor = await StaffAsync(http, auth, cancellationToken);
        if (actor.Error is not null) return actor.Error;
        if (body.VenueId is null || body.VenueId == Guid.Empty || body.UserId is null || body.UserId == Guid.Empty)
        {
            return Form("Choose a venue and a player.");
        }

        if (!await dashboard.CanAccessVenueAsync(actor.UserId, actor.Role, body.VenueId.Value, cancellationToken)) return Missing();
        var venue = await dashboard.FindVenueAsync(body.VenueId.Value, cancellationToken);
        if (venue is null) return Missing();
        var rate = venue.PointsPerDollar < 1 ? 100 : venue.PointsPerDollar;
        var maxPoints = rate * 10;
        if (body.Points is null or < 1 || body.Points > maxPoints)
        {
            return Form($"Enter 1 to {maxPoints} points. That is $10 at this venue.");
        }

        if (!VenueClock.TryGetDayWindow(venue.TimeZone, null, null, null, out var window, out var error)) return Form(error);
        var existing = await recommendations.FindTodayAsync(body.VenueId.Value, body.UserId.Value, window.StartUtc, window.EndUtc, cancellationToken);
        if (existing is not null)
        {
            return Results.Ok(WrittenJson(existing, false));
        }

        var reason = await recommendations.CandidateReasonAsync(body.VenueId.Value, body.UserId.Value, cancellationToken);
        if (reason is null)
        {
            return Form("Choose a player from the comeback list.");
        }

        var (message, source) = await copy.WriteAsync(venue.Name, body.Points.Value, reason, cancellationToken);
        var result = await recommendations.WriteNextVisitAsync(body.VenueId.Value, body.UserId.Value, body.Points.Value, message, source, reason, window.StartUtc, window.EndUtc, cancellationToken);
        if (result.Error is not null) return Form(result.Error);
        if (result.Item is null) return Form("The recommendation could not be saved.");
        return Results.Ok(WrittenJson(result.Item, result.Created));
    }

    public static async Task<IResult> MineAsync(
        int? page,
        int? pageSize,
        HttpContext http,
        AuthRepository auth,
        RecommendationRepository recommendations,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null) return SignIn();
        var result = await recommendations.ListMineAsync(current.UserId, page ?? 1, pageSize ?? 5, cancellationToken);
        return Results.Ok(new
        {
            items = result.Items.Select(item => new
            {
                id = item.Id,
                recommendationType = item.RecommendationType,
                venueName = item.VenueName,
                timeZone = item.TimeZone,
                createdAt = VenueClock.AsUtc(item.CreatedAt).ToString("O"),
                readAt = item.ReadAt is null ? null : VenueClock.AsUtc(item.ReadAt.Value).ToString("O"),
                payload = item.Payload,
            }),
            page = result.Page,
            pageSize = result.PageSize,
            total = result.Total,
        });
    }

    public static async Task<IResult> UnreadAsync(
        HttpContext http,
        AuthRepository auth,
        RecommendationRepository recommendations,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null) return SignIn();
        var count = await recommendations.CountUnreadAsync(current.UserId, cancellationToken);
        return Results.Ok(new { count });
    }

    public static async Task<IResult> MarkReadAsync(
        Guid id,
        HttpContext http,
        AuthRepository auth,
        RecommendationRepository recommendations,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null) return SignIn();
        var saved = await recommendations.MarkReadAsync(current.UserId, id, cancellationToken);
        if (!saved) return Missing();
        return Results.Ok(new { read = true });
    }

    public static async Task<IResult> MarkAllReadAsync(
        HttpContext http,
        AuthRepository auth,
        RecommendationRepository recommendations,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null) return SignIn();
        var count = await recommendations.MarkAllReadAsync(current.UserId, cancellationToken);
        return Results.Ok(new { read = count });
    }

    private static object WrittenJson(RecommendationItem item, bool created) => new
    {
        created,
        id = item.Id,
        userEmail = item.UserEmail,
        displayName = item.DisplayName,
        recommendationType = item.RecommendationType,
        venueName = item.VenueName,
        timeZone = item.TimeZone,
        createdAt = VenueClock.AsUtc(item.CreatedAt).ToString("O"),
        payload = item.Payload,
    };

    private static async Task<(Guid UserId, string Role, IResult? Error)> StaffAsync(
        HttpContext http,
        AuthRepository auth,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null) return (Guid.Empty, "", SignIn());
        var user = await auth.FindUserByIdAsync(current.UserId, cancellationToken);
        if (user is null) return (Guid.Empty, "", SignIn());
        if (user.Role is not ("admin" or "staff")) return (Guid.Empty, "", Form("You cannot use the dashboard.", StatusCodes.Status403Forbidden));
        return (user.Id, user.Role, null);
    }

    private static IResult Form(string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new { errors = new Dictionary<string, string[]> { ["form"] = [message] } }, statusCode: status);

    private static IResult SignIn() => Form("Sign in again.", StatusCodes.Status401Unauthorized);

    private static IResult Missing() => Form("That record was not found.", StatusCodes.Status404NotFound);

    public sealed record WriteRecommendationBody(Guid? VenueId, Guid? UserId, int? Points);
}
