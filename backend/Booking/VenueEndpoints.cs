using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Booking;

public static class VenueEndpoints
{
    public static void MapVenueEndpoints(this WebApplication app)
    {
        var venues = app.MapGroup("/api/venues");
        venues.MapGet("/", ListAsync);
        venues.MapGet("/{slug}", GetAsync);
        venues.MapGet("/{slug}/availability", AvailabilityAsync);
        venues.MapGet("/{slug}/promotions", PromotionsAsync);
        venues.MapGet("/{slug}/slots/{sessionId:guid}", SlotAsync);

        app.MapGet("/api/dashboard/venues", DashboardVenuesAsync).RequireAuthorization();
    }

    private static async Task<IResult> ListAsync(BookingRepository repository, CancellationToken cancellationToken)
    {
        var venues = await repository.ListActiveVenuesAsync(cancellationToken);
        return Results.Ok(venues.Select(VenueResponse));
    }

    private static async Task<IResult> GetAsync(string slug, BookingRepository repository, CancellationToken cancellationToken)
    {
        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        return venue is null ? Results.NotFound() : Results.Ok(VenueResponse(venue));
    }

    private static async Task<IResult> AvailabilityAsync(
        string slug,
        string? date,
        string? from,
        string? to,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Results.NotFound();
        }

        if (!VenueClock.TryGetDayWindow(venue.TimeZone, date, from, to, out var window, out var error))
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]> { ["form"] = [error] },
            }, statusCode: StatusCodes.Status400BadRequest);
        }

        var rows = await repository.ListAvailableSlotsAsync(venue.Id, window.StartUtc, window.EndUtc, cancellationToken);
        var courts = rows.GroupBy(row => row.CourtId).Select(group =>
        {
            var court = group.First();
            return new
            {
                id = court.CourtId,
                courtName = court.CourtName,
                courtNumber = court.CourtNumber,
                surfaceType = court.SurfaceType,
                imageUrl = court.ImageUrl,
                description = court.Description,
                slots = group.Select(slot => new
                {
                    id = slot.SessionId,
                    startTime = VenueClock.AsUtc(slot.StartTime),
                    endTime = VenueClock.AsUtc(slot.EndTime),
                    price = slot.Price,
                    incentivePoints = slot.IncentivePoints,
                }),
            };
        });

        return Results.Ok(new
        {
            venue = VenueResponse(venue),
            date = window.Date,
            courts,
        });
    }

    private static async Task<IResult> PromotionsAsync(string slug, BookingRepository repository, CancellationToken cancellationToken)
    {
        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Results.NotFound();
        }

        var promotions = await repository.ListPromotionsAsync(venue.Id, cancellationToken);
        return Results.Ok(promotions.Select(promotion => new
        {
            id = promotion.Id,
            code = promotion.Code,
            discountType = promotion.DiscountType,
            discountValue = promotion.DiscountValue,
            venueId = promotion.VenueId,
        }));
    }

    private static async Task<IResult> SlotAsync(
        string slug,
        Guid sessionId,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Results.NotFound();
        }

        var slot = await repository.FindSlotAsync(venue.Id, sessionId, cancellationToken);
        if (slot is null)
        {
            return Results.NotFound();
        }

        return Results.Ok(new
        {
            venue = VenueResponse(venue),
            id = slot.Id,
            courtName = slot.CourtName,
            courtNumber = slot.CourtNumber,
            startTime = VenueClock.AsUtc(slot.StartTime),
            endTime = VenueClock.AsUtc(slot.EndTime),
            price = slot.Price,
            incentivePoints = slot.IncentivePoints,
        });
    }

    private static async Task<IResult> DashboardVenuesAsync(
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (current is null)
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]> { ["form"] = ["Sign in again."] },
            }, statusCode: StatusCodes.Status401Unauthorized);
        }

        var user = await authRepository.FindUserByIdAsync(current.UserId, cancellationToken);
        if (user is null || user.Role is not ("staff" or "admin"))
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]> { ["form"] = ["You cannot view the dashboard."] },
            }, statusCode: StatusCodes.Status403Forbidden);
        }

        var venues = await repository.ListDashboardVenuesAsync(user.Id, user.Role, cancellationToken);
        return Results.Ok(venues.Select(VenueResponse));
    }

    internal static object VenueResponse(VenueRow venue) => new
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
    };
}
