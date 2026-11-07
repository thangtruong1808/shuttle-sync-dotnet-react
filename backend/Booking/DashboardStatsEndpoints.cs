using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public static class DashboardStatsEndpoints
{
    public static void MapDashboardStatsEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/dashboard/stats").RequireAuthorization();
        group.MapGet("/overview", GetOverviewAsync);
        group.MapGet("/trends", GetTrendsAsync);
        group.MapGet("/demand", GetDemandAsync);
        group.MapGet("/players", GetPlayersAsync);
    }

    private static async Task<IResult> GetOverviewAsync(
        string? venueId,
        string? period,
        string? date,
        string? from,
        string? to,
        bool? compare,
        HttpContext http,
        AuthRepository auth,
        DashboardStatsRepository stats,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveRequestAsync(
            venueId,
            period,
            date,
            from,
            to,
            http,
            auth,
            stats,
            cancellationToken);
        if (resolved.Error is not null)
        {
            return resolved.Error;
        }

        var result = await stats.GetOverviewAsync(
            resolved.Scope!,
            resolved.Window!,
            compare ?? true,
            cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> GetTrendsAsync(
        string? venueId,
        string? period,
        string? date,
        string? from,
        string? to,
        bool? compare,
        HttpContext http,
        AuthRepository auth,
        DashboardStatsRepository stats,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveRequestAsync(
            venueId,
            period,
            date,
            from,
            to,
            http,
            auth,
            stats,
            cancellationToken);
        if (resolved.Error is not null)
        {
            return resolved.Error;
        }

        var result = await stats.GetTrendsAsync(
            resolved.Scope!,
            resolved.Window!,
            compare ?? true,
            cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> GetDemandAsync(
        string? venueId,
        string? period,
        string? date,
        string? from,
        string? to,
        HttpContext http,
        AuthRepository auth,
        DashboardStatsRepository stats,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveRequestAsync(
            venueId,
            period,
            date,
            from,
            to,
            http,
            auth,
            stats,
            cancellationToken);
        if (resolved.Error is not null)
        {
            return resolved.Error;
        }

        var result = await stats.GetDemandAsync(
            resolved.Scope!,
            resolved.Window!,
            cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<IResult> GetPlayersAsync(
        string? venueId,
        string? period,
        string? date,
        string? from,
        string? to,
        HttpContext http,
        AuthRepository auth,
        DashboardStatsRepository stats,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveRequestAsync(
            venueId,
            period,
            date,
            from,
            to,
            http,
            auth,
            stats,
            cancellationToken);
        if (resolved.Error is not null)
        {
            return resolved.Error;
        }

        var result = await stats.GetPlayersAsync(
            resolved.Scope!,
            resolved.Window!,
            cancellationToken);
        return Results.Ok(result);
    }

    private static async Task<ResolvedStatsContext> ResolveRequestAsync(
        string? venueId,
        string? period,
        string? date,
        string? from,
        string? to,
        HttpContext http,
        AuthRepository auth,
        DashboardStatsRepository stats,
        CancellationToken cancellationToken)
    {
        var session = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (session is null)
        {
            return new ResolvedStatsContext(null, null, ErrorForm("Sign in again.", StatusCodes.Status401Unauthorized));
        }

        var user = await auth.FindUserByIdAsync(session.UserId, cancellationToken);
        if (user is null)
        {
            return new ResolvedStatsContext(null, null, ErrorForm("Sign in again.", StatusCodes.Status401Unauthorized));
        }

        if (user.Role is not ("admin" or "staff"))
        {
            return new ResolvedStatsContext(null, null, ErrorForm("You cannot use the dashboard.", StatusCodes.Status403Forbidden));
        }

        var accessibleVenues = await stats.ListAccessibleVenuesAsync(user.Id, user.Role, cancellationToken);
        if (!DashboardStatsRepository.TryResolveScope(accessibleVenues, venueId, out var scope, out var scopeError, out var statusCode))
        {
            return new ResolvedStatsContext(null, null, ErrorForm(scopeError, statusCode));
        }

        if (!DashboardStatsRepository.TryResolvePeriod(scope.TimeZone, period, date, from, to, out var window, out var periodError))
        {
            return new ResolvedStatsContext(null, null, ErrorForm(periodError, StatusCodes.Status400BadRequest));
        }

        return new ResolvedStatsContext(scope, window, null);
    }

    private static IResult ErrorForm(string message, int statusCode) =>
        Results.Json(
            new { errors = new Dictionary<string, string[]> { ["form"] = [message] } },
            statusCode: statusCode);

    private sealed record ResolvedStatsContext(
        StatsVenueScope? Scope,
        StatsPeriodWindow? Window,
        IResult? Error);
}

