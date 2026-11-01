using System.Globalization;
using Dapper;
using MySqlConnector;
using ShuttleSync.Api.Booking;

namespace ShuttleSync.Api.Data;

internal static class DailyClosureRules
{
    internal static bool TryRead(
        string? date,
        string? toDate,
        string? start,
        string? end,
        out DateOnly fromDate,
        out DateOnly? untilDate,
        out TimeOnly startClock,
        out TimeOnly endClock,
        out string error)
    {
        fromDate = default;
        untilDate = null;
        startClock = default;
        endClock = default;
        error = "";
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out fromDate))
        {
            error = "Choose a from date.";
            return false;
        }

        if (!string.IsNullOrWhiteSpace(toDate)
            && DateOnly.TryParseExact(toDate, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedTo)
            && parsedTo > fromDate)
        {
            untilDate = parsedTo;
        }

        if (!TryClock(start, out startClock) || !TryClock(end, out endClock))
        {
            error = "Choose a valid time.";
            return false;
        }

        if (endClock <= startClock)
        {
            error = "The end time must be later than the start time.";
            return false;
        }

        return true;
    }

    internal static bool HoursOverlap(
        DateOnly fromDate,
        DateOnly? untilDate,
        TimeOnly startClock,
        TimeOnly endClock,
        string timeZoneId,
        DateTime startUtc,
        DateTime endUtc)
    {
        if (endClock <= startClock || (untilDate is DateOnly stop && stop < fromDate) || endUtc <= startUtc)
        {
            return false;
        }

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
        catch (InvalidTimeZoneException)
        {
            return false;
        }

        var startLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
        var endLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc), zone);
        if (endLocal <= startLocal)
        {
            return false;
        }

        var first = DateOnly.FromDateTime(startLocal);
        var last = DateOnly.FromDateTime(endLocal.AddTicks(-1));
        var day = first < fromDate ? fromDate : first;
        var limit = untilDate is DateOnly until && until < last ? until : last;
        for (; day <= limit; day = day.AddDays(1))
        {
            var windowStart = day.ToDateTime(startClock);
            var windowEnd = day.ToDateTime(endClock);
            if (startLocal < windowEnd && endLocal > windowStart)
            {
                return true;
            }
        }

        return false;
    }

    internal static async Task<Func<Guid, DateTime, DateTime, bool>> BlockerAsync(
        MySqlConnection connection,
        MySqlTransaction? tx,
        Guid venueId,
        CancellationToken cancellationToken)
    {
        var zoneName = await ZoneAsync(connection, tx, venueId, cancellationToken);
        var rules = string.IsNullOrWhiteSpace(zoneName) ? [] : await LoadAsync(connection, tx, venueId, cancellationToken);
        if (rules.Length == 0 || string.IsNullOrWhiteSpace(zoneName))
        {
            return (_, _, _) => false;
        }

        return (courtId, startUtc, endUtc) => rules.Any(rule => Applies(rule, courtId) && HoursOverlap(
            DateOnly.FromDateTime(rule.FromDate),
            rule.UntilDate is DateTime until ? DateOnly.FromDateTime(until) : null,
            TimeOnly.FromTimeSpan(rule.StartTime),
            TimeOnly.FromTimeSpan(rule.EndTime),
            zoneName,
            startUtc,
            endUtc));
    }

    internal static async Task<bool> BlocksAsync(
        MySqlConnection connection,
        MySqlTransaction? tx,
        Guid venueId,
        Guid courtId,
        DateTime startUtc,
        DateTime endUtc,
        CancellationToken cancellationToken)
    {
        var block = await BlockerAsync(connection, tx, venueId, cancellationToken);
        return block(courtId, startUtc, endUtc);
    }

    internal static async Task<PublicClosureRow[]> ExpandDayAsync(
        MySqlConnection connection,
        MySqlTransaction? tx,
        Guid venueId,
        DateTime dayStartUtc,
        DateTime dayEndUtc,
        CancellationToken cancellationToken)
    {
        var zoneName = await ZoneAsync(connection, tx, venueId, cancellationToken);
        if (string.IsNullOrWhiteSpace(zoneName))
        {
            return [];
        }

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(zoneName);
        }
        catch (TimeZoneNotFoundException)
        {
            return [];
        }
        catch (InvalidTimeZoneException)
        {
            return [];
        }

        var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(dayStartUtc, DateTimeKind.Utc), zone));
        var rules = await LoadAsync(connection, tx, venueId, cancellationToken);
        var rows = new List<PublicClosureRow>();
        foreach (var rule in rules)
        {
            var from = DateOnly.FromDateTime(rule.FromDate);
            DateOnly? until = rule.UntilDate is DateTime untilValue ? DateOnly.FromDateTime(untilValue) : null;
            if (localDate < from || (until is DateOnly stop && localDate > stop))
            {
                continue;
            }

            var startClock = TimeOnly.FromTimeSpan(rule.StartTime);
            var endClock = TimeOnly.FromTimeSpan(rule.EndTime);
            if (!VenueClock.TryGetDayWindow(zoneName, localDate.ToString("yyyy-MM-dd"), startClock.ToString("HH:mm"), endClock.ToString("HH:mm"), out var window, out _))
            {
                continue;
            }

            if (window.StartUtc < dayEndUtc && window.EndUtc > dayStartUtc)
            {
                rows.Add(new PublicClosureRow
                {
                    Id = rule.Id,
                    CourtId = rule.CourtId,
                    StartTime = window.StartUtc,
                    EndTime = window.EndUtc,
                });
            }
        }

        return rows.ToArray();
    }

    internal static async Task<DashClosureRow[]> ForDashboardAsync(MySqlConnection connection, Guid venueId, CancellationToken cancellationToken)
    {
        var zoneName = await ZoneAsync(connection, null, venueId, cancellationToken);
        if (string.IsNullOrWhiteSpace(zoneName))
        {
            return [];
        }

        var rules = await LoadAsync(connection, null, venueId, cancellationToken);
        var rows = new List<DashClosureRow>();
        foreach (var rule in rules)
        {
            var from = DateOnly.FromDateTime(rule.FromDate);
            var startClock = TimeOnly.FromTimeSpan(rule.StartTime);
            var endClock = TimeOnly.FromTimeSpan(rule.EndTime);
            if (!VenueClock.TryGetDayWindow(zoneName, from.ToString("yyyy-MM-dd"), startClock.ToString("HH:mm"), endClock.ToString("HH:mm"), out var window, out _))
            {
                continue;
            }

            rows.Add(new DashClosureRow
            {
                Id = rule.Id,
                CourtId = rule.CourtId,
                CourtName = rule.CourtName,
                StartTime = window.StartUtc,
                EndTime = window.EndUtc,
                Reason = rule.Reason,
                RepeatsDaily = true,
                RepeatFrom = rule.FromDate,
                RepeatUntil = rule.UntilDate,
            });
        }

        return rows.ToArray();
    }

    internal static async Task<string?> ConflictAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        Guid? courtId,
        DateOnly fromDate,
        DateOnly? untilDate,
        TimeOnly startClock,
        TimeOnly endClock,
        CancellationToken cancellationToken)
    {
        var zoneName = await ZoneAsync(connection, tx, venueId, cancellationToken);
        if (string.IsNullOrWhiteSpace(zoneName))
        {
            return "This venue timezone is not available on the server.";
        }

        var clockStart = startClock.ToString("HH:mm");
        var clockEnd = endClock.ToString("HH:mm");
        if (!VenueClock.TryGetDayWindow(zoneName, fromDate.ToString("yyyy-MM-dd"), clockStart, clockEnd, out var first, out var error))
        {
            return error;
        }

        DateTime scanEnd;
        if (untilDate is DateOnly until)
        {
            if (!VenueClock.TryGetDayWindow(zoneName, until.ToString("yyyy-MM-dd"), clockStart, clockEnd, out var last, out error))
            {
                return error;
            }

            scanEnd = last.EndUtc;
        }
        else
        {
            scanEnd = first.StartUtc.AddYears(10);
        }

        var args = new { VenueId = venueId, CourtId = courtId, Start = first.StartUtc, End = scanEnd };
        var bookings = await connection.QueryAsync<BusySlot>(new CommandDefinition(
            """
            SELECT cs.StartTime, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.VenueId = @VenueId AND b.IsDeleted = 0 AND cs.IsDeleted = 0
              AND (@CourtId IS NULL OR cs.CourtId = @CourtId)
              AND cs.StartTime < @End AND cs.EndTime > @Start
              AND (
                  b.Status = 'confirmed'
                  OR (b.Status = 'pending' AND (b.HoldExpiresAt IS NULL OR b.HoldExpiresAt > UTC_TIMESTAMP(6)))
              )
            ORDER BY cs.StartTime
            """,
            args,
            tx,
            cancellationToken: cancellationToken));
        if (FirstHit(bookings, fromDate, untilDate, startClock, endClock, zoneName) is DateTime bookingHit)
        {
            return $"A booking on {bookingHit.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} already uses {Clock(startClock)}–{Clock(endClock)}. The closure is saved and that booking stays. New bookings in these hours are blocked.";
        }

        var socials = await connection.QueryAsync<BusySlot>(new CommandDefinition(
            """
            SELECT s.StartTime, s.EndTime
            FROM PublicSocials s
            WHERE s.VenueId = @VenueId AND s.IsDeleted = 0
              AND s.StartTime < @End AND s.EndTime > @Start
              AND (
                  @CourtId IS NULL
                  OR s.MaxCourts IS NULL
                  OR EXISTS (
                      SELECT 1 FROM PublicSocialRegistrations r
                      WHERE r.SocialId = s.Id AND r.CourtId = @CourtId
                        AND r.Status IN ('pending', 'confirmed')
                  )
                  OR EXISTS (
                      SELECT 1 FROM PublicSocialFriends f
                      WHERE f.SocialId = s.Id AND f.CourtId = @CourtId
                        AND f.Status IN ('pending', 'confirmed')
                  )
              )
            ORDER BY s.StartTime
            """,
            args,
            tx,
            cancellationToken: cancellationToken));
        if (FirstHit(socials, fromDate, untilDate, startClock, endClock, zoneName) is DateTime socialHit)
        {
            return $"A drop-in social on {socialHit.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} already uses {Clock(startClock)}–{Clock(endClock)}. The closure is saved and that social stays. New bookings in these hours are blocked.";
        }

        return null;
    }

    internal static async Task<string?> UpsertAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid id,
        Guid venueId,
        Guid? courtId,
        DateOnly fromDate,
        DateOnly? untilDate,
        TimeOnly startClock,
        TimeOnly endClock,
        string? reason,
        Guid actorId,
        bool replaceExisting,
        CancellationToken cancellationToken)
    {
        var args = new
        {
            Id = id,
            VenueId = venueId,
            CourtId = courtId,
            FromDate = fromDate.ToDateTime(TimeOnly.MinValue),
            UntilDate = untilDate?.ToDateTime(TimeOnly.MinValue),
            StartTime = startClock.ToTimeSpan(),
            EndTime = endClock.ToTimeSpan(),
            Reason = reason,
            ActorId = actorId,
        };
        if (!replaceExisting)
        {
            await connection.ExecuteAsync(new CommandDefinition(InsertSql, args, tx, cancellationToken: cancellationToken));
            return null;
        }

        var updated = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE DailyClosures
            SET CourtId = @CourtId, FromDate = @FromDate, UntilDate = @UntilDate,
                StartTime = @StartTime, EndTime = @EndTime, Reason = @Reason
            WHERE Id = @Id AND VenueId = @VenueId
            """,
            args,
            tx,
            cancellationToken: cancellationToken));
        if (updated > 0)
        {
            return null;
        }

        var removed = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM CourtClosures WHERE Id = @Id AND VenueId = @VenueId",
            new { Id = id, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (removed == 0)
        {
            return "That closure was not found.";
        }

        await connection.ExecuteAsync(new CommandDefinition(InsertSql, args, tx, cancellationToken: cancellationToken));
        return null;
    }

    private const string InsertSql = """
        INSERT INTO DailyClosures (Id, VenueId, CourtId, FromDate, UntilDate, StartTime, EndTime, Reason, CreatedBy, CreatedAt)
        VALUES (@Id, @VenueId, @CourtId, @FromDate, @UntilDate, @StartTime, @EndTime, @Reason, @ActorId, UTC_TIMESTAMP(6))
        """;

    private static DateTime? FirstHit(
        IEnumerable<BusySlot> slots,
        DateOnly fromDate,
        DateOnly? untilDate,
        TimeOnly startClock,
        TimeOnly endClock,
        string timeZoneId)
    {
        foreach (var slot in slots)
        {
            if (!HoursOverlap(fromDate, untilDate, startClock, endClock, timeZoneId, slot.StartTime, slot.EndTime))
            {
                continue;
            }

            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(slot.StartTime, DateTimeKind.Utc), zone);
        }

        return null;
    }

    private static bool Applies(Rule rule, Guid courtId) => rule.CourtId is null || rule.CourtId == courtId;

    private static bool TryClock(string? value, out TimeOnly clock)
    {
        clock = default;
        return TimeOnly.TryParseExact(value, ["HH:mm", "HH:mm:ss", "H:mm"], CultureInfo.InvariantCulture, DateTimeStyles.None, out clock);
    }

    private static string Clock(TimeOnly value) => value.ToString("h:mm tt", CultureInfo.GetCultureInfo("en-AU")).ToLowerInvariant();

    private static async Task<string?> ZoneAsync(MySqlConnection connection, MySqlTransaction? tx, Guid venueId, CancellationToken cancellationToken) =>
        await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT TimeZone FROM Venues WHERE Id = @VenueId",
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));

    private static async Task<Rule[]> LoadAsync(MySqlConnection connection, MySqlTransaction? tx, Guid venueId, CancellationToken cancellationToken)
    {
        var rows = await connection.QueryAsync<Rule>(new CommandDefinition(
            """
            SELECT d.Id, d.CourtId, d.FromDate, d.UntilDate, d.StartTime, d.EndTime, d.Reason, c.CourtName
            FROM DailyClosures d
            LEFT JOIN Courts c ON c.Id = d.CourtId AND c.VenueId = d.VenueId
            WHERE d.VenueId = @VenueId
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    private sealed class Rule
    {
        public Guid Id { get; set; }
        public Guid? CourtId { get; set; }
        public DateTime FromDate { get; set; }
        public DateTime? UntilDate { get; set; }
        public TimeSpan StartTime { get; set; }
        public TimeSpan EndTime { get; set; }
        public string? Reason { get; set; }
        public string? CourtName { get; set; }
    }

    private sealed class BusySlot
    {
        public DateTime StartTime { get; set; }
        public DateTime EndTime { get; set; }
    }
}
