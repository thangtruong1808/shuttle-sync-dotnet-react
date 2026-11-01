using System.Globalization;
using System.Text.Json;
using MySqlConnector;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

using static SupportDiscoveryShared;

internal readonly record struct HoldPayDecision(bool Allowed, bool PayNow, bool MoreThan24HoursAway, bool RequiresPayNow, string? Error);

public static class SupportBookingTools
{
    public static object[] Declarations { get; } =
    [
        new
        {
            name = "create_court_hold",
            description = "Hold one or more courts for a signed-in player. Sessions more than 24 hours away can be held and paid later. Sessions within 24 hours need pay_now and stay held for 30 minutes.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["courtIds"] = new { type = "ARRAY", items = new { type = "STRING" }, description = "Court ids to hold." },
                    ["courtNumbers"] = new { type = "ARRAY", items = new { type = "INTEGER" }, description = "Court numbers, used when court ids are not known." },
                    ["date"] = new { type = "STRING", description = "Date as YYYY-MM-DD, today, or tomorrow." },
                    ["start"] = new { type = "STRING", description = "Start time, such as 18:00 or 6pm." },
                    ["end"] = new { type = "STRING", description = "End time, such as 19:00 or 7pm." },
                    ["weeks"] = new { type = "INTEGER", description = "How many weekly sessions to hold, from 1 to 12." },
                    ["repeatWeekly"] = new { type = "BOOLEAN", description = "Keep one week ahead after each week passes." },
                    ["payTiming"] = new { type = "STRING", description = "pay_now or pay_later. Required before a hold is saved." },
                },
                required = new[] { "date", "start", "end", "payTiming" },
            },
        },
        new
        {
            name = "join_public_social",
            description = "Reserve the signed-in player's place in a public drop-in social. An unpaid place is released after 30 minutes.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["socialId"] = new { type = "STRING", description = "Public social id." },
                    ["pointsToRedeem"] = new { type = "INTEGER", description = "Optional reward points to apply." },
                    ["promotionCode"] = new { type = "STRING", description = "Optional promotion code." },
                },
                required = new[] { "socialId" },
            },
        },
        new
        {
            name = "create_stripe_checkout",
            description = "Start payment for a held court group or a single court session. Applies an optional promotion code and reward points. A $0 balance confirms the booking. Any cash opens Stripe Checkout.",
            parameters = new
            {
                type = "OBJECT",
                properties = new Dictionary<string, object>
                {
                    ["groupId"] = new { type = "STRING", description = "Hold group id. Use this for a court hold." },
                    ["sessionId"] = new { type = "STRING", description = "Single court session id, when there is no group." },
                    ["bookingIds"] = new { type = "ARRAY", items = new { type = "STRING" }, description = "Optional booking ids inside the group to pay now." },
                    ["promotionCode"] = new { type = "STRING", description = "Optional promotion code." },
                    ["pointsToRedeem"] = new { type = "INTEGER", description = "Optional reward points to apply." },
                },
            },
        },
    ];

    public static async Task<SupportToolExecutionResult?> TryExecuteAsync(
        SupportToolCall call,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository bookingRepository,
        DashboardRepository dashboardRepository,
        BookingPayments payments,
        AuthSettings authSettings,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "create_court_hold" => await CreateCourtHoldAsync(call.Args, http, authRepository, bookingRepository, dashboardRepository, venue, pageDate, cancellationToken),
            "join_public_social" => await JoinPublicSocialAsync(call.Args, http, authRepository, bookingRepository, venue, cancellationToken),
            "create_stripe_checkout" => await SupportCheckoutTool.CreateAsync(call.Args, http, authRepository, payments, authSettings, venue, cancellationToken),
            _ => null,
        };
    }

    private static async Task<SupportToolExecutionResult> CreateCourtHoldAsync(
        JsonElement args,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        DashboardRepository dashboard,
        VenueRow? venue,
        string? pageDate,
        CancellationToken cancellationToken)
    {
        var session = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (session is null)
        {
            return SignInRequired(venue);
        }

        if (venue is null || !TryGetZone(venue.TimeZone, out _))
        {
            return new SupportToolExecutionResult(new { error = "Choose a venue before holding a court." });
        }

        var courtIds = await ResolveCourtsAsync(args, repository, venue.Id, cancellationToken);
        if (courtIds.Error is not null)
        {
            return new SupportToolExecutionResult(new { error = courtIds.Error });
        }

        if (!TryWindow(args, venue.TimeZone, pageDate, out var window, out var windowError))
        {
            return new SupportToolExecutionResult(new { error = windowError });
        }

        var weeks = Math.Clamp(ReadInt(args, "weeks") ?? 1, 1, 12);
        var repeatWeekly = ReadBool(args, "repeatWeekly") ?? false;
        var decision = DecideHoldPay(ReadString(args, "payTiming"), window.StartUtc, DateTime.UtcNow);
        if (decision.RequiresPayNow)
        {
            return new SupportToolExecutionResult(new
            {
                error = decision.Error,
                requiresPayNow = true,
                moreThan24HoursAway = false,
            });
        }

        if (!decision.Allowed)
        {
            return new SupportToolExecutionResult(new
            {
                error = decision.Error,
                moreThan24HoursAway = decision.MoreThan24HoursAway,
            });
        }

        var payNow = decision.PayNow;
        var moreThan24HoursAway = decision.MoreThan24HoursAway;

        (Guid GroupId, CourtHoldRow[] Rows, string? Error, string? Notice) opened;
        try
        {
            opened = await repository.OpenCourtHoldGroupAsync(
                venue.Id,
                session.UserId,
                courtIds.Ids,
                venue.HourlyRate,
                venue.TimeZone,
                window.StartUtc,
                window.EndUtc,
                weeks,
                cancellationToken,
                payWithin24Hours: payNow,
                seriesWeeks: weeks,
                repeatHold: repeatWeekly);
        }
        catch (MySqlException)
        {
            return new SupportToolExecutionResult(new { error = "That date and time could not be saved. It may already be booked." });
        }

        if (opened.Error is not null)
        {
            return new SupportToolExecutionResult(new { error = opened.Error, moreThan24HoursAway });
        }

        foreach (var row in opened.Rows)
        {
            try
            {
                await dashboard.SnapshotBookingIncentiveAsync(venue.Id, row.SessionId, session.UserId, cancellationToken);
            }
            catch (Exception)
            {
                // The hold is already saved. Payment can still continue.
            }
        }

        if (opened.Rows.Length > 0)
        {
            await repository.RepackOverlappingSocialsAsync(
                venue.Id,
                opened.Rows.Min(row => row.StartTime),
                opened.Rows.Max(row => row.EndTime),
                cancellationToken);
        }

        var dueNow = opened.Rows.Where(row => row.StartTime <= DateTime.UtcNow.AddHours(24)).ToArray();
        var actions = new List<SupportChatAction>
        {
            new(
                Kind: "my_bookings_link",
                Label: "View in My Bookings",
                Href: "/profile/bookings",
                GroupId: opened.GroupId.ToString("D")),
        };
        return new SupportToolExecutionResult(
            new
            {
                groupId = opened.GroupId,
                status = "pending",
                payTiming = dueNow.Length > 0 ? "pay_now" : "pay_later",
                moreThan24HoursAway,
                repeatWeekly,
                weeks,
                notice = opened.Notice,
                paymentRule = dueNow.Length > 0
                    ? "Sessions starting within 24 hours must be paid now. The unpaid hold lasts 30 minutes."
                    : payNow
                        ? "This session is held until 24 hours before it starts. You can pay now, or pay in My Bookings before then."
                        : "Later sessions stay held until 24 hours before each start. Pay in My Bookings before then, or the court is released.",
                courts = opened.Rows.Select(row => new
                {
                    bookingId = row.BookingId,
                    sessionId = row.SessionId,
                    courtName = row.CourtName,
                    start = FormatClock(row.StartTime, TimeZoneInfo.FindSystemTimeZoneById(venue.TimeZone)),
                    end = FormatClock(row.EndTime, TimeZoneInfo.FindSystemTimeZoneById(venue.TimeZone)),
                    price = row.Price,
                    payNow = row.StartTime <= DateTime.UtcNow.AddHours(24),
                }).ToArray(),
            },
            actions);
    }

    private static async Task<SupportToolExecutionResult> JoinPublicSocialAsync(
        JsonElement args,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        VenueRow? venue,
        CancellationToken cancellationToken)
    {
        var session = await AuthEndpoints.CurrentSessionAsync(http, authRepository, cancellationToken);
        if (session is null)
        {
            return SignInRequired(venue);
        }

        if (venue is null)
        {
            return new SupportToolExecutionResult(new { error = "Choose a venue before joining a social." });
        }

        if (!Guid.TryParse(ReadString(args, "socialId"), out var socialId) || socialId == Guid.Empty)
        {
            return new SupportToolExecutionResult(new { error = "Choose a public social first." });
        }

        var hold = await repository.BeginPublicSocialCheckoutAsync(
            venue.Id,
            socialId,
            session.UserId,
            venue.Currency,
            Math.Max(0, ReadInt(args, "pointsToRedeem") ?? 0),
            ReadString(args, "promotionCode"),
            cancellationToken);
        if (hold.Error is not null)
        {
            return new SupportToolExecutionResult(new { error = hold.Error });
        }

        return new SupportToolExecutionResult(new
        {
            socialId,
            registrationId = hold.RegistrationId,
            status = hold.Status,
            alreadyJoined = hold.AlreadyJoined,
            needsPayment = hold.NeedsPayment,
            currency = hold.Currency,
            subtotal = hold.Subtotal,
            discountAmount = hold.DiscountAmount,
            pointsRedeemed = hold.PointsRedeemed,
            pointsValue = hold.PointsValue,
            cashAmount = hold.Amount,
            courtName = hold.CourtName,
            courtNumber = hold.CourtNumber,
            paymentRule = hold.NeedsPayment
                ? "This place is held for 30 minutes. Pay before then or it is released."
                : "This place is confirmed.",
        });
    }

    internal static HoldPayDecision DecideHoldPay(string? payTiming, DateTime startUtc, DateTime nowUtc)
    {
        var timing = (payTiming ?? "").Trim().ToLowerInvariant().Replace('-', '_');
        var payNow = timing is "pay_now";
        var payLater = timing is "pay_later";
        var moreThan24HoursAway = startUtc > nowUtc.AddHours(24);
        if (!payNow && !payLater)
        {
            return new HoldPayDecision(false, false, moreThan24HoursAway, false, "Choose pay_now or pay_later before a hold is saved.");
        }

        if (!moreThan24HoursAway && payLater)
        {
            return new HoldPayDecision(false, false, false, true, "This session starts within 24 hours, so it cannot be held to pay later. Choose pay_now. The unpaid hold lasts 30 minutes.");
        }

        return new HoldPayDecision(true, payNow, moreThan24HoursAway, false, null);
    }

    internal static SupportToolExecutionResult SignInRequired(VenueRow? venue, string? message = null)
    {
        var next = venue is null ? "/" : $"/{venue.Slug}";
        return new SupportToolExecutionResult(
            new { requires_auth = true, error = message ?? "Sign in before holding a court or joining a social." },
            [
                new SupportChatAction(
                    Kind: "login_link",
                    Label: "Sign in to continue",
                    Href: $"/login?next={Uri.EscapeDataString(next)}"),
            ]);
    }

    private static bool TryWindow(JsonElement args, string timeZone, string? pageDate, out VenueClock.DayWindow window, out string error)
    {
        window = default;
        error = "";
        if (!TryGetZone(timeZone, out var zone))
        {
            error = "This venue timezone is not available on the server.";
            return false;
        }

        var date = ResolveDate(ReadString(args, "date") ?? pageDate, zone);
        if (!TryParseClockFlexible(ReadString(args, "start"), out var start) || !TryParseClockFlexible(ReadString(args, "end"), out var end))
        {
            error = "Use a start and end time, such as 18:00 and 19:00.";
            return false;
        }

        return VenueClock.TryGetDayWindow(
            timeZone,
            date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            start.ToString("HH:mm", CultureInfo.InvariantCulture),
            end.ToString("HH:mm", CultureInfo.InvariantCulture),
            out window,
            out error);
    }

    private static async Task<(Guid[] Ids, string? Error)> ResolveCourtsAsync(
        JsonElement args,
        BookingRepository repository,
        Guid venueId,
        CancellationToken cancellationToken)
    {
        var ids = ReadGuids(args, "courtIds");
        var single = ReadString(args, "courtId");
        if (Guid.TryParse(single, out var courtId) && courtId != Guid.Empty)
        {
            ids.Add(courtId);
        }

        var numbers = ReadNumbers(args, "courtNumbers");
        var oneNumber = ReadInt(args, "courtNumber");
        if (oneNumber is int number)
        {
            numbers.Add(number);
        }

        if (numbers.Count > 0)
        {
            var courts = await repository.ListPublicCourtsAsync(venueId, cancellationToken);
            foreach (var courtNumber in numbers.Distinct())
            {
                var match = courts.FirstOrDefault(court => court.CourtNumber == courtNumber);
                if (match is null)
                {
                    return ([], $"Court {courtNumber} is not open at this venue.");
                }

                ids.Add(match.Id);
            }
        }

        var distinct = ids.Where(id => id != Guid.Empty).Distinct().ToArray();
        return distinct.Length == 0 ? ([], "Choose at least one court.") : (distinct, null);
    }

    private static List<Guid> ReadGuids(JsonElement args, string name)
    {
        var ids = new List<Guid>();
        if (!TryProperty(args, name, out var value))
        {
            return ids;
        }

        if (value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var id))
        {
            ids.Add(id);
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String && Guid.TryParse(item.GetString(), out var parsed))
                {
                    ids.Add(parsed);
                }
            }
        }

        return ids;
    }

    private static List<int> ReadNumbers(JsonElement args, string name)
    {
        var numbers = new List<int>();
        if (!TryProperty(args, name, out var value))
        {
            return numbers;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            numbers.Add(number);
        }

        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Number && item.TryGetInt32(out var parsed))
                {
                    numbers.Add(parsed);
                }
            }
        }

        return numbers;
    }

    private static bool TryProperty(JsonElement args, string name, out JsonElement value)
    {
        value = default;
        return args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out value);
    }
}
