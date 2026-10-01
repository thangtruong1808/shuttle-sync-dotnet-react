using System.Globalization;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;
using ShuttleSync.Api.Media;

namespace ShuttleSync.Api.Booking;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var dash = app.MapGroup("/api/dashboard").RequireAuthorization();
        dash.MapGet("/overview", OverviewAsync);
        dash.MapPost("/venues", CreateVenueAsync);
        dash.MapGet("/venues/{venueId:guid}", GetVenueAsync);
        dash.MapPut("/venues/{venueId:guid}", UpdateVenueAsync);
        dash.MapDelete("/venues/{venueId:guid}", DeleteVenueAsync);
        dash.MapGet("/venues/{venueId:guid}/courts", ListCourtsAsync);
        dash.MapPost("/venues/{venueId:guid}/courts", CreateCourtAsync);
        dash.MapPut("/venues/{venueId:guid}/courts/{courtId:guid}", UpdateCourtAsync);
        dash.MapDelete("/venues/{venueId:guid}/courts/{courtId:guid}", DeleteCourtAsync);
        dash.MapGet("/venues/{venueId:guid}/sessions", ListSessionsAsync);
        dash.MapPost("/venues/{venueId:guid}/sessions", CreateSessionsAsync);
        dash.MapPut("/venues/{venueId:guid}/sessions/{sessionId:guid}", UpdateSessionAsync);
        dash.MapDelete("/venues/{venueId:guid}/sessions/{sessionId:guid}", DeleteSessionAsync);
        dash.MapPut("/venues/{venueId:guid}/sessions/{sessionId:guid}/incentive", SaveIncentiveAsync);
        dash.MapDelete("/venues/{venueId:guid}/sessions/{sessionId:guid}/incentive", DeleteIncentiveAsync);
        dash.MapGet("/venues/{venueId:guid}/incentives", ListVenueIncentivesAsync);
        dash.MapPost("/venues/{venueId:guid}/incentives", CreateVenueIncentiveAsync);
        dash.MapPut("/venues/{venueId:guid}/incentives/{incentiveId:guid}", UpdateVenueIncentiveAsync);
        dash.MapDelete("/venues/{venueId:guid}/incentives/{incentiveId:guid}", DeleteVenueIncentiveAsync);
        dash.MapGet("/venues/{venueId:guid}/closures", ListClosuresAsync);
        dash.MapPost("/venues/{venueId:guid}/closures", CreateClosureAsync);
        dash.MapPut("/venues/{venueId:guid}/closures/{closureId:guid}", UpdateClosureAsync);
        dash.MapDelete("/venues/{venueId:guid}/closures/{closureId:guid}", DeleteClosureAsync);
        dash.MapGet("/promotions", ListPromotionsAsync);
        dash.MapPost("/promotions", CreatePromotionAsync);
        dash.MapPut("/promotions/{promotionId:guid}", UpdatePromotionAsync);
        dash.MapGet("/users", ListUsersAsync);
        dash.MapGet("/users/{userId:guid}", GetUserAsync);
        dash.MapPut("/users/{userId:guid}", UpdateUserAsync);
        dash.MapDelete("/users/{userId:guid}", DeleteUserAsync);
        dash.MapPost("/users/{userId:guid}/venues/{venueId:guid}", AssignVenueAsync);
        dash.MapDelete("/users/{userId:guid}/venues/{venueId:guid}", UnassignVenueAsync);
        dash.MapDelete("/users/{userId:guid}/sessions/{sessionId:guid}", RevokeDeviceAsync);
        dash.MapGet("/bookings", ListBookingsAsync);
        dash.MapPut("/bookings/{bookingId:guid}/status", UpdateBookingAsync);
        dash.MapGet("/payments", ListPaymentsAsync);
        dash.MapGet("/refunds", ListRefundsAsync);
        dash.MapGet("/webhooks", ListWebhooksAsync);
        dash.MapGet("/redemptions", ListRedemptionsAsync);
        dash.MapGet("/awards", ListAwardsAsync);
        dash.MapGet("/recommendations", ListRecommendationsAsync);
        dash.MapGet("/activity", ListActivityAsync);
        dash.MapPost("/activity/page-view", PageViewAsync);
        dash.MapPost("/images", UploadImageAsync);
    }

    private static async Task<IResult> OverviewAsync(HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsStaff) return Forbidden();
        var counts = await repo.CountsAsync(actor.UserId, actor.Role, cancellationToken);
        return Results.Ok(new { venues = counts.Venues, courts = counts.Courts, role = actor.Role });
    }

    private static async Task<IResult> CreateVenueAsync(VenueBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!TryVenue(body, Guid.NewGuid(), out var write, out var error)) return Form(error);
        error = await repo.CreateVenueAsync(write, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> GetVenueAsync(Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        return venue is null ? Missing() : Results.Ok(VenueJson(venue));
    }

    private static async Task<IResult> UpdateVenueAsync(Guid venueId, VenueBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        var current = await repo.FindVenueAsync(venueId, cancellationToken);
        if (current is null) return Missing();
        var merged = actor.IsAdmin
            ? body
            : body with
            {
                Name = current.Name,
                Slug = current.Slug,
                TimeZone = current.TimeZone,
                Currency = current.Currency,
                Country = current.Country,
                Latitude = current.Latitude,
                Longitude = current.Longitude,
                IsActive = current.IsActive,
            };
        if (!TryVenue(merged, venueId, out var write, out var error)) return Form(error);
        error = await repo.UpdateVenueAsync(write, actor.IsAdmin, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteVenueAsync(Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        var error = await repo.SoftDeleteVenueAsync(venueId, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> ListCourtsAsync(Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var rows = await repo.ListCourtsAsync(venueId, cancellationToken);
        return Results.Ok(rows.Select(court => new
        {
            id = court.Id,
            courtName = court.CourtName,
            courtNumber = court.CourtNumber,
            description = court.Description,
            surfaceType = court.SurfaceType,
            imageUrl = court.ImageUrl,
            isActive = court.IsActive,
        }));
    }

    private static async Task<IResult> CreateCourtAsync(Guid venueId, CourtBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        if (!TryCourt(body, Guid.NewGuid(), venueId, out var write, out var error)) return Form(error);
        error = await repo.SaveCourtAsync(write, true, gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> UpdateCourtAsync(Guid venueId, Guid courtId, CourtBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        if (!TryCourt(body, courtId, venueId, out var write, out var error)) return Form(error);
        error = await repo.SaveCourtAsync(write, false, gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteCourtAsync(Guid venueId, Guid courtId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var error = await repo.SoftDeleteCourtAsync(venueId, courtId, gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> ListSessionsAsync(Guid venueId, string? date, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        if (venue is null) return Missing();
        if (!VenueClock.TryGetDayWindow(venue.TimeZone, date, null, null, out var window, out var error)) return Form(error);
        var rows = await repo.ListSessionsAsync(venueId, window.StartUtc, window.EndUtc, cancellationToken);
        return Results.Ok(rows.Select(row => new
        {
            id = row.Id,
            courtId = row.CourtId,
            courtName = row.CourtName,
            courtNumber = row.CourtNumber,
            startTime = Utc(row.StartTime),
            endTime = Utc(row.EndTime),
            price = row.Price,
            incentivePoints = row.IncentiveActive == true ? row.IncentivePoints : null,
            timeZone = venue.TimeZone,
        }));
    }

    private static async Task<IResult> CreateSessionsAsync(Guid venueId, SessionBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        if (venue is null) return Missing();
        if (body.Price < 0) return Form("Price cannot be negative.");
        if (!VenueClock.TryGetDayWindow(venue.TimeZone, body.Date, body.Start, body.End, out var window, out var error)) return Form(error);
        var slots = new List<(DateTime Start, DateTime End, decimal Price)> { (window.StartUtc, window.EndUtc, body.Price) };
        error = await repo.CreateSessionsAsync(venueId, body.CourtId, slots, DateOnly.Parse(window.Date), gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> UpdateSessionAsync(Guid venueId, Guid sessionId, SessionEditBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        if (venue is null) return Missing();
        if (body.Price < 0) return Form("Price cannot be negative.");
        if (!VenueClock.TryGetDayWindow(venue.TimeZone, body.Date, body.Start, body.End, out var window, out var error)) return Form(error);
        error = await repo.UpdateSessionAsync(venueId, sessionId, body.CourtId, window.StartUtc, window.EndUtc, body.Price, DateOnly.Parse(window.Date), gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteSessionAsync(Guid venueId, Guid sessionId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var error = await repo.SoftDeleteSessionAsync(venueId, sessionId, gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> SaveIncentiveAsync(Guid venueId, Guid sessionId, IncentiveBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        if (body.Points <= 0) return Form("Points must be greater than zero.");
        var error = await repo.SaveIncentiveAsync(venueId, sessionId, body.Points, body.IsActive, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteIncentiveAsync(Guid venueId, Guid sessionId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        var error = await repo.DeleteIncentiveAsync(venueId, sessionId, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> ListVenueIncentivesAsync(Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        var rows = await repo.ListVenueIncentivesAsync(venueId, cancellationToken);
        return Results.Ok(rows.Select(row => new
        {
            id = row.Id,
            points = row.Points,
            startsOn = row.StartsOn.ToString("yyyy-MM-dd"),
            endsOn = row.EndsOn.ToString("yyyy-MM-dd"),
            isActive = row.IsActive,
        }));
    }

    private static async Task<IResult> CreateVenueIncentiveAsync(Guid venueId, VenueIncentiveBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        if (!TryIncentiveRange(body, out var startsOn, out var endsOn, out var error)) return Form(error);
        error = await repo.SaveVenueIncentiveAsync(venueId, null, startsOn, endsOn, body.Points, body.IsActive, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> UpdateVenueIncentiveAsync(Guid venueId, Guid incentiveId, VenueIncentiveBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        if (!TryIncentiveRange(body, out var startsOn, out var endsOn, out var error)) return Form(error);
        error = await repo.SaveVenueIncentiveAsync(venueId, incentiveId, startsOn, endsOn, body.Points, body.IsActive, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteVenueIncentiveAsync(Guid venueId, Guid incentiveId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return Missing();
        var error = await repo.DeleteVenueIncentiveAsync(venueId, incentiveId, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static bool TryIncentiveRange(VenueIncentiveBody body, out DateOnly startsOn, out DateOnly endsOn, out string error)
    {
        startsOn = default;
        endsOn = default;
        if (body.Points <= 0)
        {
            error = "Points must be greater than zero.";
            return false;
        }

        if (!DateOnly.TryParse(body.StartsOn, out startsOn) || !DateOnly.TryParse(body.EndsOn, out endsOn))
        {
            error = "Choose a valid date range.";
            return false;
        }

        error = "";
        return true;
    }

    private static async Task<IResult> ListClosuresAsync(Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        var rows = await repo.ListClosuresAsync(venueId, cancellationToken);
        return Results.Ok(rows.Select(row => new
        {
            id = row.Id,
            courtId = row.CourtId,
            courtName = row.CourtName ?? "Whole venue",
            startTime = Utc(row.StartTime),
            endTime = Utc(row.EndTime),
            reason = row.Reason,
            timeZone = venue?.TimeZone,
        }));
    }

    private static async Task<IResult> CreateClosureAsync(Guid venueId, ClosureBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        if (venue is null) return Missing();
        if (!VenueClock.TryGetDayWindow(venue.TimeZone, body.Date, body.Start, body.End, out var window, out var error)) return Form(error);
        error = await repo.CreateClosureAsync(venueId, body.CourtId, window.StartUtc, window.EndUtc, Trim(body.Reason, 200), gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> UpdateClosureAsync(Guid venueId, Guid closureId, ClosureBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var venue = await repo.FindVenueAsync(venueId, cancellationToken);
        if (venue is null) return Missing();
        if (!VenueClock.TryGetDayWindow(venue.TimeZone, body.Date, body.Start, body.End, out var window, out var error)) return Form(error);
        error = await repo.UpdateClosureAsync(venueId, closureId, body.CourtId, window.StartUtc, window.EndUtc, Trim(body.Reason, 200), gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteClosureAsync(Guid venueId, Guid closureId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var gate = await GateVenue(venueId, http, auth, repo, cancellationToken);
        if (gate.Error is not null) return gate.Error;
        var error = await repo.DeleteClosureAsync(venueId, closureId, gate.Actor!.UserId, gate.Actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> ListPromotionsAsync(Guid? venueId, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsStaff) return Forbidden();
        var allowed = actor.IsAdmin ? [] : await repo.AssignedVenueIdsAsync(actor.UserId, cancellationToken);
        var result = await repo.ListPromotionsAsync(venueId, allowed, actor.IsAdmin, page ?? 1, cancellationToken);
        return Results.Ok(new
        {
            items = result.Items.Select(row => new
            {
                id = row.Id,
                venueId = row.VenueId,
                code = row.Code,
                discountType = row.DiscountType,
                discountValue = row.DiscountValue,
                maxUses = row.MaxUses,
                usedCount = row.UsedCount,
                maxUsesPerUser = row.MaxUsesPerUser,
                validFrom = Utc(row.ValidFrom),
                validTo = Utc(row.ValidTo),
                isActive = row.IsActive,
            }),
            page = result.Page,
            pageSize = result.PageSize,
            total = result.Total,
        });
    }

    private static async Task<IResult> CreatePromotionAsync(PromoBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (body.VenueId is null && !actor.IsAdmin) return Forbidden();
        if (body.VenueId is not null && !await repo.CanAccessVenueAsync(actor.UserId, actor.Role, body.VenueId.Value, cancellationToken)) return Missing();
        if (!TryPromo(body, Guid.NewGuid(), out var write, out var error)) return Form(error);
        error = await repo.SavePromotionAsync(write, true, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> UpdatePromotionAsync(Guid promotionId, PromoBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (body.VenueId is null && !actor.IsAdmin) return Forbidden();
        if (body.VenueId is not null && !await repo.CanAccessVenueAsync(actor.UserId, actor.Role, body.VenueId.Value, cancellationToken)) return Missing();
        if (!TryPromo(body, promotionId, out var write, out var error)) return Form(error);
        error = await repo.SavePromotionAsync(write, false, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> ListUsersAsync(string? q, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        var result = await repo.ListUsersAsync(q, page ?? 1, cancellationToken);
        return Results.Ok(new
        {
            items = result.Items.Select(UserJson),
            page = result.Page,
            pageSize = result.PageSize,
            total = result.Total,
        });
    }

    private static async Task<IResult> GetUserAsync(Guid userId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        var user = await repo.FindUserAsync(userId, cancellationToken);
        if (user is null) return Missing();
        var venues = await repo.ListAssignedVenuesAsync(userId, cancellationToken);
        var logins = await repo.ListExternalLoginsAsync(userId, cancellationToken);
        var sessions = await repo.ListUserSessionsAsync(userId, cancellationToken);
        return Results.Ok(new
        {
            user = UserJson(user),
            venues = venues.Select(row => new { id = row.Id, name = row.Name }),
            logins = logins.Select(row => new { provider = row.Provider, emailAtLink = row.EmailAtLink, createdAt = Utc(row.CreatedAt) }),
            sessions = sessions.Select(row => new { id = row.Id, userAgent = row.UserAgent, ipAddress = row.IpAddress, lastUsedAt = Utc(row.LastUsedAt) }),
        });
    }

    private static async Task<IResult> UpdateUserAsync(Guid userId, UserBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (body.Role is not ("user" or "staff" or "admin")) return Form("Choose a valid role.");
        var error = await repo.UpdateUserAsync(userId, Trim(body.DisplayName, 200), Trim(body.FirstName, 100), Trim(body.LastName, 100), Trim(body.Mobile, 32), body.Role, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> DeleteUserAsync(Guid userId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        if (actor.UserId == userId) return Form("You cannot delete your own account here.");
        var error = await repo.SoftDeleteUserAsync(userId, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> AssignVenueAsync(Guid userId, Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        var error = await repo.AssignVenueAsync(userId, venueId, actor.UserId, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> UnassignVenueAsync(Guid userId, Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        await repo.UnassignVenueAsync(userId, venueId, actor.UserId, actor.Ip, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> RevokeDeviceAsync(Guid userId, Guid sessionId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsAdmin) return Forbidden();
        var revoked = await auth.RevokeSessionAsync(sessionId, userId, cancellationToken);
        if (revoked is null) return Form("That session was not found.");
        return Results.NoContent();
    }

    private static async Task<IResult> ListBookingsAsync(Guid? venueId, string? status, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsStaff) return Forbidden();
        var allowed = actor.IsAdmin ? [] : await repo.AssignedVenueIdsAsync(actor.UserId, cancellationToken);
        var result = await repo.ListOperationalBookingsAsync(venueId, allowed, actor.IsAdmin, status, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, row => new
        {
            id = row.Id,
            venueId = row.VenueId,
            venueName = row.VenueName,
            timeZone = row.TimeZone,
            courtName = row.CourtName,
            status = row.Status,
            totalAmount = row.TotalAmount,
            currency = row.Currency,
            startTime = Utc(row.StartTime),
            endTime = Utc(row.EndTime),
            userEmail = row.UserEmail,
        }));
    }

    private static async Task<IResult> UpdateBookingAsync(Guid bookingId, StatusBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsStaff) return Forbidden();
        var error = await repo.UpdateBookingStatusAsync(bookingId, body.Status ?? "", actor.UserId, actor.Role, actor.Ip, cancellationToken);
        return error is null ? Results.NoContent() : Form(error);
    }

    private static async Task<IResult> ListPaymentsAsync(Guid? venueId, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var scoped = await Scope(http, auth, repo, cancellationToken);
        if (scoped.Error is not null) return scoped.Error;
        var result = await repo.ListPaymentsAsync(venueId, scoped.Allowed, scoped.Actor!.IsAdmin, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, PaymentJson));
    }

    private static async Task<IResult> ListRefundsAsync(Guid? venueId, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var scoped = await Scope(http, auth, repo, cancellationToken);
        if (scoped.Error is not null) return scoped.Error;
        var result = await repo.ListRefundsAsync(venueId, scoped.Allowed, scoped.Actor!.IsAdmin, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, PaymentJson));
    }

    private static async Task<IResult> ListWebhooksAsync(int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var scoped = await Scope(http, auth, repo, cancellationToken);
        if (scoped.Error is not null) return scoped.Error;
        var result = await repo.ListWebhooksAsync(scoped.Actor!.IsAdmin, scoped.Allowed, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, row => new { id = row.Id, eventType = row.EventType, status = row.Status, createdAt = Utc(row.CreatedAt) }));
    }

    private static async Task<IResult> ListRedemptionsAsync(Guid? venueId, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var scoped = await Scope(http, auth, repo, cancellationToken);
        if (scoped.Error is not null) return scoped.Error;
        var result = await repo.ListRedemptionsAsync(venueId, scoped.Allowed, scoped.Actor!.IsAdmin, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, row => new
        {
            id = row.Id,
            code = row.Code,
            userEmail = row.UserEmail,
            venueName = row.VenueName,
            discountAmount = row.DiscountAmount,
            createdAt = Utc(row.CreatedAt),
        }));
    }

    private static async Task<IResult> ListAwardsAsync(Guid? venueId, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var scoped = await Scope(http, auth, repo, cancellationToken);
        if (scoped.Error is not null) return scoped.Error;
        var result = await repo.ListAwardsAsync(venueId, scoped.Allowed, scoped.Actor!.IsAdmin, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, row => new
        {
            id = row.Id,
            userEmail = row.UserEmail,
            venueName = row.VenueName,
            timeZone = row.TimeZone,
            points = row.Points,
            awardedAt = Utc(row.AwardedAt),
            startTime = Utc(row.StartTime),
            endTime = Utc(row.EndTime),
        }));
    }

    private static async Task<IResult> ListRecommendationsAsync(int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var scoped = await Scope(http, auth, repo, cancellationToken);
        if (scoped.Error is not null) return scoped.Error;
        var result = await repo.ListRecommendationsAsync(scoped.Actor!.IsAdmin, scoped.Allowed, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, row => new
        {
            id = row.Id,
            userEmail = row.UserEmail,
            recommendationType = row.RecommendationType,
            createdAt = Utc(row.CreatedAt),
            venueName = row.VenueName,
        }));
    }

    private static async Task<IResult> ListActivityAsync(Guid? userId, string? from, string? to, int? page, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsStaff) return Forbidden();
        if (!TryDate(from, false, out var fromUtc, out var error) || !TryDate(to, true, out var toUtc, out error)) return Form(error);
        var only = actor.IsAdmin ? (Guid?)null : actor.UserId;
        var filter = actor.IsAdmin ? userId : null;
        var result = await repo.ListActivityAsync(only, filter, fromUtc, toUtc, page ?? 1, cancellationToken);
        return Results.Ok(Page(result, row => new
        {
            id = row.Id,
            userEmail = row.UserEmail,
            displayName = row.DisplayName,
            action = row.Action,
            entity = row.Entity,
            detail = row.NewValues,
            createdAt = Utc(row.CreatedAt),
            venueName = row.VenueName,
        }));
    }

    private static async Task<IResult> PageViewAsync(PageViewBody body, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (actor.Role != "staff") return Results.NoContent();
        var path = (body.Path ?? "").Trim();
        if (!path.StartsWith("/dashboard", StringComparison.Ordinal) || path.Contains("//", StringComparison.Ordinal))
        {
            return Form("That page cannot be recorded.");
        }

        if (body.VenueId is not null && !await repo.CanAccessVenueAsync(actor.UserId, actor.Role, body.VenueId.Value, cancellationToken))
        {
            return Results.NoContent();
        }

        await repo.RecordPageViewAsync(actor.UserId, body.VenueId, path, Trim(body.Title, 100) ?? "Dashboard", actor.Ip, cancellationToken);
        return Results.NoContent();
    }

    private static async Task<IResult> UploadImageAsync(HttpRequest request, HttpContext http, AuthRepository auth, CloudinaryImages images, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return SignIn();
        if (!actor.IsStaff) return Forbidden();
        if (!request.HasFormContentType) return Form("Choose an image file.");
        var folder = request.Form["folder"].ToString();
        if (folder is not ("venues" or "courts")) return Form("Choose a venue or court photo.");
        var file = request.Form.Files.GetFile("file");
        if (file is null || file.Length == 0 || file.Length > 2 * 1024 * 1024) return Form("Use an image up to 2 MB.");
        var contentType = file.ContentType.Split(';', 2)[0].Trim().ToLowerInvariant();
        if (contentType is "image/jpg") contentType = "image/jpeg";
        if (contentType is not ("image/jpeg" or "image/png" or "image/webp")) return Form("Use a JPEG, PNG, or WebP image.");
        try
        {
            await using var stream = file.OpenReadStream();
            var url = await images.UploadAsync(stream, contentType, folder, Guid.NewGuid().ToString("D"), cancellationToken);
            return Results.Ok(new { url });
        }
        catch (Exception exception) when (exception is InvalidOperationException or HttpRequestException)
        {
            return Form("The photo could not be uploaded. Try again.", StatusCodes.Status502BadGateway);
        }
    }

    private static async Task<Gate> GateVenue(Guid venueId, HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return new Gate(null, SignIn());
        if (!actor.IsStaff) return new Gate(null, Forbidden());
        if (!await repo.CanAccessVenueAsync(actor.UserId, actor.Role, venueId, cancellationToken)) return new Gate(null, Missing());
        return new Gate(actor, null);
    }

    private static async Task<ScopeResult> Scope(HttpContext http, AuthRepository auth, DashboardRepository repo, CancellationToken cancellationToken)
    {
        var actor = await ActorAsync(http, auth, cancellationToken);
        if (actor is null) return new ScopeResult(null, [], SignIn());
        if (!actor.IsStaff) return new ScopeResult(null, [], Forbidden());
        var allowed = actor.IsAdmin ? Array.Empty<Guid>() : await repo.AssignedVenueIdsAsync(actor.UserId, cancellationToken);
        return new ScopeResult(actor, allowed, null);
    }

    private static async Task<DashActor?> ActorAsync(HttpContext http, AuthRepository auth, CancellationToken cancellationToken)
    {
        var session = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (session is null) return null;
        var user = await auth.FindUserByIdAsync(session.UserId, cancellationToken);
        if (user is null) return null;
        var ip = http.Connection.RemoteIpAddress?.ToString();
        if (ip is { Length: > 64 }) ip = ip[..64];
        return new DashActor(user.Id, user.Role, ip);
    }

    private static bool TryVenue(VenueBody body, Guid id, out DashVenueWrite write, out string error)
    {
        write = default!;
        var name = (body.Name ?? "").Trim();
        var slug = (body.Slug ?? "").Trim().ToLowerInvariant();
        if (name.Length is 0 or > 150) { error = "Enter a venue name up to 150 characters."; return false; }
        if (slug.Length is 0 or > 100 || !SlugOk(slug)) { error = "Use a slug of lowercase letters, numbers, and hyphens."; return false; }
        var zone = string.IsNullOrWhiteSpace(body.TimeZone) ? "Australia/Melbourne" : body.TimeZone.Trim();
        try { _ = TimeZoneInfo.FindSystemTimeZoneById(zone); }
        catch (TimeZoneNotFoundException) { error = "Choose a valid timezone."; return false; }
        var currency = string.IsNullOrWhiteSpace(body.Currency) ? "AUD" : body.Currency.Trim().ToUpperInvariant();
        if (currency.Length is < 3 or > 10) { error = "Enter a currency code."; return false; }
        write = new DashVenueWrite(id, name, slug, Trim(body.Description, 1000), Trim(body.Address, 300), Trim(body.Suburb, 100), Trim(body.State, 50), Trim(body.Postcode, 20), string.IsNullOrWhiteSpace(body.Country) ? "AU" : body.Country.Trim().ToUpperInvariant(), body.Latitude, body.Longitude, Trim(body.Phone, 32), Trim(body.Email, 256), Trim(body.ImageUrl, 500), zone, currency, body.IsActive);
        error = "";
        return true;
    }

    private static bool TryCourt(CourtBody body, Guid id, Guid venueId, out DashCourtWrite write, out string error)
    {
        write = default!;
        var name = (body.CourtName ?? "").Trim();
        if (name.Length is 0 or > 100) { error = "Enter a court name up to 100 characters."; return false; }
        if (body.CourtNumber < 1) { error = "Court number must be at least 1."; return false; }
        write = new DashCourtWrite(id, venueId, name, body.CourtNumber, Trim(body.Description, 500), Trim(body.SurfaceType, 50), Trim(body.ImageUrl, 500), body.IsActive);
        error = "";
        return true;
    }

    private static bool TryPromo(PromoBody body, Guid id, out DashPromoWrite write, out string error)
    {
        write = default!;
        var code = (body.Code ?? "").Trim().ToUpperInvariant();
        if (code.Length is 0 or > 50) { error = "Enter a promotion code."; return false; }
        if (body.DiscountType is not ("fixed" or "percent")) { error = "Choose fixed or percent."; return false; }
        if (body.DiscountValue <= 0 || (body.DiscountType == "percent" && body.DiscountValue > 100)) { error = "Enter a valid discount."; return false; }
        if (!DateTime.TryParse(body.ValidFrom, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var from)
            || !DateTime.TryParse(body.ValidTo, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var to)
            || to <= from)
        {
            error = "Enter a valid date range.";
            return false;
        }

        write = new DashPromoWrite(id, body.VenueId, code, body.DiscountType, body.DiscountValue, body.MaxUses, body.MaxUsesPerUser < 1 ? 1 : body.MaxUsesPerUser, from, to, body.IsActive);
        error = "";
        return true;
    }

    private static bool TryDate(string? value, bool exclusiveEnd, out DateTime? parsed, out string error)
    {
        parsed = null;
        error = "";
        if (string.IsNullOrWhiteSpace(value)) return true;
        if (!DateOnly.TryParse(value, out var date))
        {
            error = "Choose a valid date.";
            return false;
        }

        parsed = date.AddDays(exclusiveEnd ? 1 : 0).ToDateTime(TimeOnly.MinValue);
        return true;
    }

    private static bool SlugOk(string slug) => slug.All(character => char.IsAsciiLetterOrDigit(character) || character == '-') && !slug.StartsWith('-') && !slug.EndsWith('-');

    private static string? Trim(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    private static string Utc(DateTime value) => VenueClock.AsUtc(value).ToString("O");

    private static object UserJson(DashUserRow user) => new
    {
        id = user.Id,
        email = user.Email,
        displayName = user.DisplayName,
        firstName = user.FirstName,
        lastName = user.LastName,
        mobile = user.Mobile,
        role = user.Role,
        rewardPoints = user.RewardPoints,
        emailVerified = user.EmailVerified,
    };

    private static object VenueJson(DashVenueRow venue) => new
    {
        id = venue.Id,
        name = venue.Name,
        slug = venue.Slug,
        description = venue.Description,
        address = venue.Address,
        suburb = venue.Suburb,
        state = venue.State,
        postcode = venue.Postcode,
        country = venue.Country,
        latitude = venue.Latitude,
        longitude = venue.Longitude,
        phone = venue.Phone,
        email = venue.Email,
        imageUrl = venue.ImageUrl,
        timeZone = venue.TimeZone,
        currency = venue.Currency,
        isActive = venue.IsActive,
    };

    private static object PaymentJson(DashPaymentRow row) => new
    {
        id = row.Id,
        kind = row.Kind,
        venueName = row.VenueName,
        amount = row.Amount,
        currency = row.Currency,
        status = row.Status,
        occurredAt = Utc(row.OccurredAt),
    };

    private static object Page<TIn, TOut>(DashPage<TIn> page, Func<TIn, TOut> map) => new
    {
        items = page.Items.Select(map),
        page = page.Page,
        pageSize = page.PageSize,
        total = page.Total,
    };

    private static IResult Form(string message, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new { errors = new Dictionary<string, string[]> { ["form"] = [message] } }, statusCode: status);

    private static IResult SignIn() => Form("Sign in again.", StatusCodes.Status401Unauthorized);

    private static IResult Forbidden() => Form("You cannot use the dashboard.", StatusCodes.Status403Forbidden);

    private static IResult Missing() => Form("That record was not found.", StatusCodes.Status404NotFound);

    private sealed record DashActor(Guid UserId, string Role, string? Ip)
    {
        public bool IsAdmin => Role == "admin";
        public bool IsStaff => Role is "admin" or "staff";
    }

    private sealed record Gate(DashActor? Actor, IResult? Error);

    private sealed record ScopeResult(DashActor? Actor, IReadOnlyCollection<Guid> Allowed, IResult? Error);

    private sealed record VenueBody(string? Name, string? Slug, string? Description, string? Address, string? Suburb, string? State, string? Postcode, string? Country, decimal? Latitude, decimal? Longitude, string? Phone, string? Email, string? ImageUrl, string? TimeZone, string? Currency, bool IsActive);

    private sealed record CourtBody(string? CourtName, int CourtNumber, string? Description, string? SurfaceType, string? ImageUrl, bool IsActive);

    private sealed record SessionBody(Guid CourtId, string? Date, string? Start, string? End, decimal Price, string? Until);

    private sealed record SessionEditBody(Guid CourtId, string? Date, string? Start, string? End, decimal Price);

    private sealed record IncentiveBody(int Points, bool IsActive);

    private sealed record VenueIncentiveBody(string? StartsOn, string? EndsOn, int Points, bool IsActive);

    private sealed record ClosureBody(Guid? CourtId, string? Date, string? Start, string? End, string? Reason);

    private sealed record PromoBody(Guid? VenueId, string? Code, string? DiscountType, decimal DiscountValue, int? MaxUses, int MaxUsesPerUser, string? ValidFrom, string? ValidTo, bool IsActive);

    private sealed record UserBody(string? DisplayName, string? FirstName, string? LastName, string? Mobile, string? Role);

    private sealed record StatusBody(string? Status);

    private sealed record PageViewBody(string? Path, string? Title, Guid? VenueId);
}
