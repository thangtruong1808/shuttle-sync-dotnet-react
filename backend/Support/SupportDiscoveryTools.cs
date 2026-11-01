using System.Globalization;
using System.Text.Json;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

using static SupportDiscoveryShared;

public sealed record SuggestedCourtSlot(
    Guid CourtId,
    string CourtName,
    int CourtNumber,
    string Date,
    string DateLabel,
    string Start,
    string End,
    string WindowLabel,
    decimal Price,
    bool MoreThan24HoursAway);

public static class SupportDiscoveryTools
{
    public static object[] Declarations { get; } =
    [
        new
        {
            name = "get_user_booking_context",
            description = "Check whether the player is signed in, read their reward points balance, and get the active venue's booking, pricing, and cancellation rules.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>(),
            },
        },
        new
        {
            name = "check_court_availability",
            description = "Check which courts are available at the venue for a specific date (YYYY-MM-DD or 'today'/'tomorrow') and optional start/end time (24h HH:mm or 12h like '6pm'/'18:00'). Also returns prices and active reward point incentives.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["date"] = new { type = "STRING", description = "Target date in YYYY-MM-DD, or 'today' / 'tomorrow'." },
                    ["startTime"] = new { type = "STRING", description = "Optional start time in HH:mm (24h) or e.g. '6:00 pm'." },
                    ["endTime"] = new { type = "STRING", description = "Optional end time in HH:mm (24h) or e.g. '8:00 pm'." },
                    ["weeks"] = new { type = "INTEGER", description = "Optional number of weeks (1 to 12) if checking a multi-week hold." },
                },
                required = new[] { "date" },
            },
        },
        new
        {
            name = "suggest_alternative_slots",
            description = "Find available court time slots on the target date (and next day if needed) when a player's requested time is full or when they ask what times are free.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["date"] = new { type = "STRING", description = "Preferred date in YYYY-MM-DD, or 'today' / 'tomorrow'." },
                    ["preferredStartTime"] = new { type = "STRING", description = "Optional preferred start time in HH:mm (e.g. '18:00') to find the closest open slots." },
                    ["durationMinutes"] = new { type = "INTEGER", description = "Desired duration in minutes (default 60, minimum 30)." },
                },
                required = new[] { "date" },
            },
        },
        new
        {
            name = "list_active_promotions_and_socials",
            description = "List all active promotion codes (discounts) and upcoming drop-in public social sessions at the current venue.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["date"] = new { type = "STRING", description = "Optional date in YYYY-MM-DD to filter upcoming socials." },
                },
            },
        },
        new
        {
            name = "preview_booking_quote",
            description = "Calculate the exact price breakdown (subtotal, promotion code discount, reward points value, and cash due) for booking one or more courts over 1 to 12 weeks.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["date"] = new { type = "STRING", description = "Start date in YYYY-MM-DD." },
                    ["startTime"] = new { type = "STRING", description = "Start time in HH:mm (24h)." },
                    ["endTime"] = new { type = "STRING", description = "End time in HH:mm (24h)." },
                    ["courtCount"] = new { type = "INTEGER", description = "Number of courts (default 1)." },
                    ["weeks"] = new { type = "INTEGER", description = "Number of weeks (1 to 12, default 1)." },
                    ["promotionCode"] = new { type = "STRING", description = "Optional promotion code to apply." },
                    ["pointsToRedeem"] = new { type = "INTEGER", description = "Optional reward points to redeem." },
                },
                required = new[] { "date", "startTime", "endTime" },
            },
        },
    ];

    public static async Task<SupportToolExecutionResult?> TryExecuteAsync(
        SupportToolCall call,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository bookingRepository,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "get_user_booking_context" => await GetUserBookingContextAsync(http, authRepository, venue, cancellationToken),
            "check_court_availability" => await CheckCourtAvailabilityAsync(call.Args, bookingRepository, venue, pageDate, cancellationToken),
            "suggest_alternative_slots" => await SuggestAlternativeSlotsAsync(call.Args, bookingRepository, venue, pageDate, cancellationToken),
            "list_active_promotions_and_socials" => await ListPromotionsAndSocialsAsync(call.Args, bookingRepository, venue, pageDate, cancellationToken),
            "preview_booking_quote" => await SupportQuotePreview.PreviewAsync(call.Args, http, authRepository, bookingRepository, venue, pageDate, cancellationToken),
            _ => null,
        };
    }

    private static async Task<SupportToolExecutionResult> GetUserBookingContextAsync(
        HttpContext http,
        AuthRepository authRepository,
        VenueRow? venue,
        CancellationToken cancellationToken)
    {
        var session = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        var user = session is null ? null : await authRepository.FindUserByIdAsync(session.UserId, cancellationToken);

        var actions = new List<SupportChatAction>();
        if (user is null && venue is not null)
        {
            actions.Add(new SupportChatAction(
                Kind: "login_link",
                Label: "Sign in to book",
                Href: $"/login?next=%2F{Uri.EscapeDataString(venue.Slug)}"));
        }

        return new SupportToolExecutionResult(
            new
            {
                isAuthenticated = user is not null,
                displayName = user?.DisplayName ?? user?.FirstName,
                email = user?.Email,
                rewardPoints = user?.RewardPoints ?? 0,
                venue = venue is null
                    ? null
                    : new
                    {
                        id = venue.Id,
                        name = venue.Name,
                        slug = venue.Slug,
                        currency = venue.Currency,
                        hourlyRate = venue.HourlyRate,
                        socialPrice = venue.SocialPrice,
                        pointsPerDollar = venue.PointsPerDollar,
                        lateCancelFeePercent = venue.LateCancelFeePercent,
                        timeZone = venue.TimeZone,
                    },
                rules = new
                {
                    holdAndPayLaterRule = "Sessions starting more than 24 hours from now can be held immediately without advance payment (1 to 12 weeks or weekly rolling repeat). Payment must be completed at least 24 hours before playtime in My Bookings, otherwise the court hold or social spot is automatically released for other players.",
                    within24HoursRule = "Sessions starting within 24 hours require immediate Stripe checkout. The unpaid hold lasts 30 minutes.",
                    stripePaymentMethods = new[] { "Card", "Apple Pay", "Google Pay", "BECS Direct Debit", "PayTo" },
                },
            },
            actions);
    }

    private static async Task<SupportToolExecutionResult> CheckCourtAvailabilityAsync(
        JsonElement args,
        BookingRepository repository,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken)
    {
        if (venue is null)
        {
            return new SupportToolExecutionResult(new { error = "No active venue is selected." });
        }

        if (!TryGetZone(venue.TimeZone, out var zone))
        {
            return new SupportToolExecutionResult(new { error = "Venue timezone is invalid." });
        }

        var date = ResolveDate(ReadString(args, "date") ?? pageDate, zone);
        var startRaw = ReadString(args, "startTime");
        var endRaw = ReadString(args, "endTime");
        var weeks = Math.Clamp(ReadInt(args, "weeks") ?? 1, 1, 12);

        var dayStartUtc = TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), zone);
        var dayEndUtc = TimeZoneInfo.ConvertTimeToUtc(date.AddDays(1).ToDateTime(TimeOnly.MinValue), zone);
        var courts = await repository.ListPublicCourtsAsync(venue.Id, cancellationToken);
        var sessions = await repository.ListSupportSessionsAsync(venue.Id, dayStartUtc, dayEndUtc, cancellationToken);
        var closures = await repository.ListPublicClosuresAsync(venue.Id, dayStartUtc, dayEndUtc, cancellationToken);
        var rates = await repository.ListRateWindowsAsync(venue.Id, cancellationToken);
        var incentives = await repository.ListPublicIncentivesAsync(venue.Id, date, cancellationToken);

        if (string.IsNullOrWhiteSpace(startRaw) || string.IsNullOrWhiteSpace(endRaw)
            || !TryParseClockFlexible(startRaw, out var startClock)
            || !TryParseClockFlexible(endRaw, out var endClock))
        {
            var openSuggestions = FindOpenWindowsForDay(courts, sessions, closures, rates, zone, date, venue.HourlyRate, 60, null);
            return new SupportToolExecutionResult(new
            {
                venueName = venue.Name,
                currency = venue.Currency,
                date = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                dateFormatted = date.ToString("dddd, d MMMM yyyy", CultureInfo.InvariantCulture),
                incentivePoints = incentives.FirstOrDefault()?.Points ?? 0,
                courts = courts.Select(c => new
                {
                    courtId = c.Id,
                    courtName = string.IsNullOrWhiteSpace(c.CourtName) ? $"Court {c.CourtNumber}" : c.CourtName,
                    courtNumber = c.CourtNumber,
                    surfaceType = c.SurfaceType,
                    occupiedBlocks = sessions
                        .Where(s => s.CourtId == c.Id && s.Taken > 0)
                        .Select(s => $"{FormatClock(s.StartTime, zone)}–{FormatClock(s.EndTime, zone)}")
                        .Concat(closures
                            .Where(cl => cl.CourtId is null || cl.CourtId == c.Id)
                            .Select(cl => $"Closed {FormatClock(cl.StartTime, zone)}–{FormatClock(cl.EndTime, zone)}"))
                        .ToArray(),
                }),
                sampleAvailableWindows = openSuggestions.Take(8).ToArray(),
            });
        }

        var startLocal = date.ToDateTime(startClock);
        var endLocal = date.ToDateTime(endClock);
        if (endLocal <= startLocal)
        {
            endLocal = endLocal.AddDays(1);
        }

        var startUtc = TimeZoneInfo.ConvertTimeToUtc(startLocal, zone);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(endLocal, zone);
        if (endUtc - startUtc < TimeSpan.FromMinutes(30))
        {
            return new SupportToolExecutionResult(new { error = "The minimum booking duration is 30 minutes." });
        }

        if (startUtc <= DateTime.UtcNow)
        {
            var alternatives = FindOpenWindowsForDay(courts, sessions, closures, rates, zone, date, venue.HourlyRate, (int)(endUtc - startUtc).TotalMinutes, startClock);
            return new SupportToolExecutionResult(new
            {
                error = "That start time has already passed.",
                suggestedAlternatives = alternatives.Take(6).ToArray(),
            });
        }

        var moreThan24HoursAway = startUtc > DateTime.UtcNow.AddHours(24);
        var singleSessionPrice = decimal.Round(CourtRates.Quote(venue.TimeZone, venue.HourlyRate, startUtc, endUtc, rates), 2, MidpointRounding.AwayFromZero);

        var availableCourts = new List<object>();
        var unavailableCourts = new List<object>();
        foreach (var court in courts)
        {
            var blockReason = GetBlockReason(court.Id, startUtc, endUtc, sessions, closures, zone);
            var name = string.IsNullOrWhiteSpace(court.CourtName) ? $"Court {court.CourtNumber}" : court.CourtName;
            if (blockReason is null)
            {
                availableCourts.Add(new
                {
                    courtId = court.Id,
                    courtName = name,
                    courtNumber = court.CourtNumber,
                    surfaceType = court.SurfaceType,
                    pricePerSession = singleSessionPrice,
                    totalForWeeks = singleSessionPrice * weeks,
                });
            }
            else
            {
                unavailableCourts.Add(new
                {
                    courtId = court.Id,
                    courtName = name,
                    courtNumber = court.CourtNumber,
                    reason = blockReason,
                });
            }
        }

        var suggestedWhenFull = availableCourts.Count == 0
            ? FindOpenWindowsForDay(courts, sessions, closures, rates, zone, date, venue.HourlyRate, (int)(endUtc - startUtc).TotalMinutes, startClock).Take(6).ToArray()
            : [];

        return new SupportToolExecutionResult(new
        {
            venueName = venue.Name,
            currency = venue.Currency,
            date = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            dateFormatted = date.ToString("dddd, d MMMM yyyy", CultureInfo.InvariantCulture),
            startTime24 = startClock.ToString("HH:mm", CultureInfo.InvariantCulture),
            endTime24 = endClock.ToString("HH:mm", CultureInfo.InvariantCulture),
            windowFormatted = $"{FormatClock(startUtc, zone)}–{FormatClock(endUtc, zone)}",
            weeks,
            moreThan24HoursAway,
            canHoldAndPayLater = moreThan24HoursAway,
            incentivePoints = incentives.FirstOrDefault()?.Points ?? 0,
            availableCourts,
            unavailableCourts,
            suggestedAlternatives = suggestedWhenFull,
        });
    }

    private static async Task<SupportToolExecutionResult> SuggestAlternativeSlotsAsync(
        JsonElement args,
        BookingRepository repository,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken)
    {
        if (venue is null || !TryGetZone(venue.TimeZone, out var zone))
        {
            return new SupportToolExecutionResult(new { error = "Venue schedule could not be loaded." });
        }

        var date = ResolveDate(ReadString(args, "date") ?? pageDate, zone);
        var duration = Math.Clamp(ReadInt(args, "durationMinutes") ?? 60, 30, 240);
        TimeOnly? preferred = TryParseClockFlexible(ReadString(args, "preferredStartTime"), out var parsedClock) ? parsedClock : null;

        var courts = await repository.ListPublicCourtsAsync(venue.Id, cancellationToken);
        var rates = await repository.ListRateWindowsAsync(venue.Id, cancellationToken);

        var dayStartUtc = TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), zone);
        var dayEndUtc = TimeZoneInfo.ConvertTimeToUtc(date.AddDays(1).ToDateTime(TimeOnly.MinValue), zone);
        var sessions = await repository.ListSupportSessionsAsync(venue.Id, dayStartUtc, dayEndUtc, cancellationToken);
        var closures = await repository.ListPublicClosuresAsync(venue.Id, dayStartUtc, dayEndUtc, cancellationToken);

        var suggestions = FindOpenWindowsForDay(courts, sessions, closures, rates, zone, date, venue.HourlyRate, duration, preferred).ToList();
        if (suggestions.Count < 4)
        {
            var nextDate = date.AddDays(1);
            var nextStartUtc = TimeZoneInfo.ConvertTimeToUtc(nextDate.ToDateTime(TimeOnly.MinValue), zone);
            var nextEndUtc = TimeZoneInfo.ConvertTimeToUtc(nextDate.AddDays(1).ToDateTime(TimeOnly.MinValue), zone);
            var nextSessions = await repository.ListSupportSessionsAsync(venue.Id, nextStartUtc, nextEndUtc, cancellationToken);
            var nextClosures = await repository.ListPublicClosuresAsync(venue.Id, nextStartUtc, nextEndUtc, cancellationToken);
            suggestions.AddRange(FindOpenWindowsForDay(courts, nextSessions, nextClosures, rates, zone, nextDate, venue.HourlyRate, duration, preferred).Take(6));
        }

        return new SupportToolExecutionResult(new
        {
            venueName = venue.Name,
            currency = venue.Currency,
            requestedDate = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            durationMinutes = duration,
            suggestions = suggestions.Take(8).ToArray(),
        });
    }

    private static async Task<SupportToolExecutionResult> ListPromotionsAndSocialsAsync(
        JsonElement args,
        BookingRepository repository,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken)
    {
        if (venue is null || !TryGetZone(venue.TimeZone, out var zone))
        {
            return new SupportToolExecutionResult(new { error = "Venue is not available." });
        }

        var date = ResolveDate(ReadString(args, "date") ?? pageDate, zone);
        var dayStartUtc = TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), zone);
        var weekEndUtc = TimeZoneInfo.ConvertTimeToUtc(date.AddDays(7).ToDateTime(TimeOnly.MinValue), zone);

        var promotions = await repository.ListPromotionsAsync(venue.Id, cancellationToken);
        var socials = await repository.ListPublicSocialsAsync(venue.Id, dayStartUtc, weekEndUtc, cancellationToken);
        var courts = await repository.ListPublicCourtsAsync(venue.Id, cancellationToken);
        var seats = await repository.ListPublicSocialSeatsAsync(socials.Select(s => s.Id).ToArray(), cancellationToken);

        return new SupportToolExecutionResult(new
        {
            venueName = venue.Name,
            currency = venue.Currency,
            promotions = promotions.Select(p => new
            {
                id = p.Id,
                code = p.Code,
                discountType = p.DiscountType,
                discountValue = p.DiscountValue,
                summary = p.DiscountType.Equals("percent", StringComparison.OrdinalIgnoreCase)
                    ? $"{p.Code} ({p.DiscountValue:0.##}% off)"
                    : $"{p.Code} ({venue.Currency} ${p.DiscountValue:0.00} off)",
                validTo = VenueClock.AsUtc(p.ValidTo),
            }).ToArray(),
            socials = socials.Select(s =>
            {
                var playerCount = seats.Count(seat => seat.SocialId == s.Id);
                var courtLimit = BookingRepository.AllowedCourtCount(courts.Length, s.MaxCourts);
                var isFull = BookingRepository.SocialIsFull(playerCount, courtLimit, s.PlayersPerCourt, s.BlockedCourts);
                var localStart = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(s.StartTime, DateTimeKind.Utc), zone);
                return new
                {
                    socialId = s.Id,
                    date = localStart.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    dateFormatted = localStart.ToString("dddd, d MMMM yyyy", CultureInfo.InvariantCulture),
                    windowFormatted = $"{FormatClock(s.StartTime, zone)}–{FormatClock(s.EndTime, zone)}",
                    price = s.Price,
                    playerCount,
                    capacity = Math.Max(0, courtLimit - s.BlockedCourts) * s.PlayersPerCourt,
                    isFull,
                    waitlistCount = s.WaitlistCount,
                };
            }).ToArray(),
        });
    }
}
