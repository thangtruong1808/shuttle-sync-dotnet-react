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
        venues.MapPost("/{slug}/sessions", OpenSessionAsync).RequireAuthorization();
        venues.MapGet("/{slug}/socials/{socialId:guid}", SocialOfferAsync);
        venues.MapPost("/{slug}/socials/{socialId:guid}/checkout", CheckoutSocialAsync).RequireAuthorization();
        venues.MapGet("/{slug}/socials/registrations/{registrationId:guid}", SocialRegistrationAsync).RequireAuthorization();

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
        HttpContext http,
        BookingRepository repository,
        AuthRepository auth,
        CancellationToken cancellationToken)
    {
        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Results.NotFound();
        }

        var fromClock = string.IsNullOrWhiteSpace(from) ? "00:00" : from;
        var toClock = string.IsNullOrWhiteSpace(to) ? "23:59" : to;
        if (!VenueClock.TryGetDayWindow(venue.TimeZone, date, fromClock, toClock, out var window, out var error))
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]> { ["form"] = [error] },
            }, statusCode: StatusCodes.Status400BadRequest);
        }

        var incentives = await repository.ListPublicIncentivesAsync(venue.Id, DateOnly.Parse(window.Date), cancellationToken);
        var bookings = await repository.ListConfirmedBookingsAsync(venue.Id, window.StartUtc, window.EndUtc, cancellationToken);
        var closures = await repository.ListPublicClosuresAsync(venue.Id, window.StartUtc, window.EndUtc, cancellationToken);
        var courtRows = await repository.ListPublicCourtsAsync(venue.Id, cancellationToken);
        await repository.ExpirePublicSocialHoldsAsync(cancellationToken);
        await repository.AwardEndedSocialIncentivesAsync(cancellationToken);
        var socials = await repository.ListPublicSocialsAsync(venue.Id, window.StartUtc, window.EndUtc, cancellationToken);
        var socialIds = socials.Select(social => social.Id).ToArray();
        var seats = await repository.ListPublicSocialSeatsAsync(socialIds, cancellationToken);
        var session = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        var mine = session is null
            ? []
            : await repository.ListMySocialStatesAsync(session.UserId, socialIds, cancellationToken);
        var mineStatus = mine.ToDictionary(row => row.SocialId, row => row.Status);
        var socialViews = socials.Select(social => BuildSocialView(social, seats, courtRows, session?.UserId, social.Price, mineStatus)).ToArray();
        var courts = courtRows.Select(court => new
        {
            id = court.Id,
            courtName = court.CourtName,
            courtNumber = court.CourtNumber,
            surfaceType = court.SurfaceType,
            imageUrl = court.ImageUrl,
            description = court.Description,
            bookings = bookings.Where(booking => booking.CourtId == court.Id).Select(booking => new
            {
                id = booking.BookingId,
                startTime = VenueClock.AsUtc(booking.StartTime),
                endTime = VenueClock.AsUtc(booking.EndTime),
            }),
            socials = socialViews
                .Where(social => social.Courts.Any(item => item.CourtId == court.Id))
                .Select(social => new
                {
                    id = social.Id,
                    startTime = social.StartTime,
                    endTime = social.EndTime,
                    players = social.Courts.First(item => item.CourtId == court.Id).Players,
                }),
        });

        return Results.Ok(new
        {
            venue = VenueResponse(venue),
            date = window.Date,
            windowStart = VenueClock.AsUtc(window.StartUtc),
            windowEnd = VenueClock.AsUtc(window.EndUtc),
            courts,
            socials = socialViews.Select(social => new
            {
                id = social.Id,
                startTime = social.StartTime,
                endTime = social.EndTime,
                playerCount = social.PlayerCount,
                price = social.Price,
                yourStatus = social.YourStatus,
                yourCourtName = social.YourCourtName,
                yourCourtNumber = social.YourCourtNumber,
            }),
            incentives = incentives.Select(incentive => new
            {
                id = incentive.Id,
                points = incentive.Points,
                startsOn = incentive.StartsOn.ToString("yyyy-MM-dd"),
                endsOn = incentive.EndsOn.ToString("yyyy-MM-dd"),
            }),
            closures = closures.Select(closure => new
            {
                id = closure.Id,
                courtId = closure.CourtId,
                startTime = VenueClock.AsUtc(closure.StartTime),
                endTime = VenueClock.AsUtc(closure.EndTime),
            }),
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
        lateCancelFeePercent = venue.LateCancelFeePercent,
        pointsPerDollar = venue.PointsPerDollar,
        hourlyRate = venue.HourlyRate,
        socialPrice = venue.SocialPrice,
    };

    private static async Task<IResult> OpenSessionAsync(
        string slug,
        OpenSessionBody body,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        DashboardRepository dashboard,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (current is null)
        {
            return Form("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        if (body.CourtId == Guid.Empty)
        {
            return Form("Choose a court.", StatusCodes.Status400BadRequest);
        }

        if (string.IsNullOrWhiteSpace(body.Start) || string.IsNullOrWhiteSpace(body.End))
        {
            return Form("Choose a start and end time.", StatusCodes.Status400BadRequest);
        }

        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Form("That venue was not found.", StatusCodes.Status404NotFound);
        }

        if (!VenueClock.TryGetDayWindow(venue.TimeZone, body.Date, body.Start, body.End, out var window, out var clockError))
        {
            return Form(clockError, StatusCodes.Status400BadRequest);
        }

        var opened = await repository.OpenPlayerSessionAsync(venue.Id, body.CourtId, venue.HourlyRate, window.StartUtc, window.EndUtc, cancellationToken);
        if (opened.Error is not null)
        {
            var status = opened.Error == "This slot is not available."
                ? StatusCodes.Status409Conflict
                : StatusCodes.Status400BadRequest;
            return Form(opened.Error, status);
        }

        try
        {
            await dashboard.SnapshotBookingIncentiveAsync(venue.Id, opened.SessionId, current.UserId, cancellationToken);
        }
        catch (Exception)
        {
            // The time is already saved. Checkout can still take payment.
        }

        return Results.Ok(new { sessionId = opened.SessionId, price = opened.Price, currency = venue.Currency });
    }

    private static async Task<IResult> SocialOfferAsync(
        string slug,
        Guid socialId,
        HttpContext http,
        BookingRepository repository,
        AuthRepository auth,
        CancellationToken cancellationToken)
    {
        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Results.NotFound();
        }

        var social = await repository.FindPublicSocialAsync(venue.Id, socialId, cancellationToken);
        if (social is null)
        {
            return Results.NotFound();
        }

        var seats = await repository.ListPublicSocialSeatsAsync([socialId], cancellationToken);
        var session = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        var mine = session is null
            ? []
            : await repository.ListMySocialStatesAsync(session.UserId, [socialId], cancellationToken);
        var yours = mine.FirstOrDefault(row => row.SocialId == socialId);
        var seat = session is null ? null : seats.FirstOrDefault(row => row.UserId == session.UserId);
        var price = social.Price <= 0 ? 0 : decimal.Round(social.Price, 2, MidpointRounding.AwayFromZero);
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(venue.TimeZone);
        }
        catch (TimeZoneNotFoundException)
        {
            zone = TimeZoneInfo.Utc;
        }

        var localDay = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(social.StartTime, DateTimeKind.Utc), zone));
        var incentives = await repository.ListPublicIncentivesAsync(venue.Id, localDay, cancellationToken);
        return Results.Ok(new
        {
            venue = VenueResponse(venue),
            id = social.Id,
            startTime = VenueClock.AsUtc(social.StartTime),
            endTime = VenueClock.AsUtc(social.EndTime),
            price,
            playerCount = seats.Length,
            yourStatus = yours?.Status,
            yourCourtName = yours?.Status == "confirmed" ? seat?.CourtName : null,
            yourCourtNumber = yours?.Status == "confirmed" ? seat?.CourtNumber : null,
            incentivePoints = incentives.FirstOrDefault()?.Points ?? 0,
        });
    }

    private static async Task<IResult> CheckoutSocialAsync(
        string slug,
        Guid socialId,
        SocialCheckoutBody body,
        HttpContext http,
        BookingRepository repository,
        AuthRepository auth,
        BookingPayments payments,
        AuthSettings authSettings,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null)
        {
            return Form("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var venue = await repository.FindActiveVenueBySlugAsync(slug, cancellationToken);
        if (venue is null)
        {
            return Form("That venue was not found.", StatusCodes.Status404NotFound);
        }

        var origin = authSettings.FrontendOrigin.TrimEnd('/');
        var successUrl = $"{origin}/{slug}/social/{socialId}?checkout=success";
        var cancelUrl = $"{origin}/{slug}/social/{socialId}?checkout=cancel";
        var result = await payments.SocialCheckoutAsync(venue.Id, socialId, current.UserId, venue.Currency, body.Points, body.PromotionCode, successUrl, cancelUrl, cancellationToken);
        if (result.Error is not null)
        {
            return Form(result.Error, result.StatusCode);
        }

        return Results.Ok(new
        {
            registrationId = result.RegistrationId,
            status = result.Status,
            checkoutUrl = result.CheckoutUrl,
            amount = result.Amount,
            currency = result.Currency,
            courtName = result.CourtName,
            courtNumber = result.CourtNumber,
            alreadyJoined = result.AlreadyJoined,
            subtotal = result.Subtotal,
            discountAmount = result.DiscountAmount,
            pointsRedeemed = result.PointsRedeemed,
            pointsValue = result.PointsValue,
            cashAmount = result.Amount,
            incentivePoints = result.IncentivePoints,
        });
    }

    private static async Task<IResult> SocialRegistrationAsync(
        string slug,
        Guid registrationId,
        HttpContext http,
        BookingRepository repository,
        AuthRepository auth,
        BookingPayments payments,
        CancellationToken cancellationToken)
    {
        var current = await AuthEndpoints.CurrentSessionAsync(http, auth, cancellationToken);
        if (current is null)
        {
            return Form("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var row = await repository.FindOwnedSocialAsync(current.UserId, registrationId, cancellationToken);
        if (row is null)
        {
            return Results.NotFound();
        }

        if (row.Status == "pending" && !string.IsNullOrWhiteSpace(row.StripePaymentIntentId))
        {
            try
            {
                await payments.SyncSocialAsync(current.UserId, registrationId, cancellationToken);
                row = await repository.FindOwnedSocialAsync(current.UserId, registrationId, cancellationToken) ?? row;
            }
            catch (Stripe.StripeException)
            {
                // The stored status is still returned when Stripe cannot be reached.
            }
        }

        return Results.Ok(new
        {
            id = row.Id,
            status = row.Status,
            courtName = row.CourtName,
            courtNumber = row.CourtNumber,
            paymentStatus = row.PaymentStatus,
            cashAmount = row.Amount,
            pointsRedeemed = row.PointsRedeemed,
            incentivePoints = row.IncentivePoints,
        });
    }

    private static SocialView BuildSocialView(
        PublicSocialRow social,
        PublicSocialSeatRow[] seats,
        PublicCourtRow[] courts,
        Guid? userId,
        decimal socialPrice,
        IReadOnlyDictionary<Guid, string> mineStatus)
    {
        var mine = seats.FirstOrDefault(seat => seat.SocialId == social.Id && userId is not null && seat.UserId == userId);
        var placed = seats.Where(seat => seat.SocialId == social.Id).GroupBy(seat => seat.CourtId).ToArray();
        var ordered = courts.OrderBy(court => court.CourtNumber).ToArray();
        var visible = placed.Length == 0
            ? ordered.Take(1).ToArray()
            : ordered.Where(court => placed.Any(group => group.Key == court.Id)).ToArray();
        mineStatus.TryGetValue(social.Id, out var yourStatus);
        var price = socialPrice <= 0 ? 0 : decimal.Round(socialPrice, 2, MidpointRounding.AwayFromZero);
        var confirmed = yourStatus == "confirmed";
        return new SocialView(
            social.Id,
            VenueClock.AsUtc(social.StartTime),
            VenueClock.AsUtc(social.EndTime),
            seats.Count(seat => seat.SocialId == social.Id),
            price,
            yourStatus,
            confirmed ? mine?.CourtName : null,
            confirmed ? mine?.CourtNumber : null,
            visible.Select(court => new SocialCourt(court.Id, placed.FirstOrDefault(group => group.Key == court.Id)?.Count() ?? 0)).ToArray());
    }

    private static IResult Form(string message, int status) =>
        Results.Json(new { errors = new Dictionary<string, string[]> { ["form"] = [message] } }, statusCode: status);

    private sealed record OpenSessionBody(Guid CourtId, string? Date, string? Start, string? End);

    private sealed record SocialCheckoutBody(int Points, string? PromotionCode = null);

    private sealed record SocialCourt(Guid CourtId, int Players);

    private sealed record SocialView(Guid Id, DateTimeOffset StartTime, DateTimeOffset EndTime, int PlayerCount, decimal Price, string? YourStatus, string? YourCourtName, int? YourCourtNumber, SocialCourt[] Courts);
}
