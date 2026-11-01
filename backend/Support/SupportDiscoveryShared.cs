using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

internal static class SupportDiscoveryShared
{
    public static IReadOnlyList<SuggestedCourtSlot> FindOpenWindowsForDay(
        IReadOnlyList<PublicCourtRow> courts,
        IReadOnlyList<SupportSessionRow> sessions,
        IReadOnlyList<PublicClosureRow> closures,
        IReadOnlyList<CourtRateWindow> rates,
        TimeZoneInfo zone,
        DateOnly date,
        decimal baseHourlyRate,
        int durationMinutes,
        TimeOnly? preferredStart,
        DateTime? nowUtc = null)
    {
        var results = new List<SuggestedCourtSlot>();
        if (courts.Count == 0)
        {
            return results;
        }

        var duration = TimeSpan.FromMinutes(Math.Clamp(durationMinutes, 30, 240));
        int[] candidateHours = [8, 9, 10, 11, 14, 16, 17, 18, 19, 20, 21];
        if (preferredStart is TimeOnly pref)
        {
            candidateHours = candidateHours
                .OrderBy(h => Math.Abs(h * 60 - (pref.Hour * 60 + pref.Minute)))
                .ToArray();
        }

        var clock = DateTime.SpecifyKind(nowUtc ?? DateTime.UtcNow, DateTimeKind.Utc);
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(clock, zone);
        var dateString = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        foreach (var hour in candidateHours)
        {
            var startClock = new TimeOnly(hour, 0);
            var startLocal = date.ToDateTime(startClock);
            var endLocal = startLocal.Add(duration);
            if (endLocal.Date > startLocal.Date && endLocal.TimeOfDay > TimeSpan.Zero)
            {
                continue;
            }

            var startUtc = TimeZoneInfo.ConvertTimeToUtc(startLocal, zone);
            var endUtc = TimeZoneInfo.ConvertTimeToUtc(endLocal, zone);
            if (startLocal <= nowLocal.AddMinutes(5) || startUtc <= clock.AddMinutes(5))
            {
                continue;
            }

            foreach (var court in courts)
            {
                if (GetBlockReason(court.Id, startUtc, endUtc, sessions, closures, zone) is not null)
                {
                    continue;
                }

                var price = decimal.Round(CourtRates.Quote(zone.Id, baseHourlyRate, startUtc, endUtc, rates.ToArray()), 2, MidpointRounding.AwayFromZero);
                var courtName = string.IsNullOrWhiteSpace(court.CourtName) ? $"Court {court.CourtNumber}" : court.CourtName.Trim();
                var endClock = TimeOnly.FromDateTime(endLocal);
                results.Add(new SuggestedCourtSlot(
                    CourtId: court.Id,
                    CourtName: courtName,
                    CourtNumber: court.CourtNumber,
                    Date: dateString,
                    DateLabel: date.ToString("dddd, d MMMM yyyy", CultureInfo.InvariantCulture),
                    Start: startClock.ToString("HH:mm", CultureInfo.InvariantCulture),
                    End: endClock.ToString("HH:mm", CultureInfo.InvariantCulture),
                    WindowLabel: $"{FormatClock(startUtc, zone)}–{FormatClock(endUtc, zone)}",
                    Price: price,
                    MoreThan24HoursAway: startUtc > clock.AddHours(24)));

                break;
            }

            if (results.Count >= 8)
            {
                break;
            }
        }

        return results;
    }

    internal readonly record struct AnchoredWindow(IReadOnlyList<SuggestedCourtSlot> Slots, string? Window, string? LastBookingEnds, string Recommendation);

    internal static AnchoredWindow CourtsAfterLastBooking(
        IReadOnlyList<PublicCourtRow> courts,
        IReadOnlyList<SupportSessionRow> sessions,
        IReadOnlyList<PublicClosureRow> closures,
        IReadOnlyList<SocialBlockRow> socials,
        IReadOnlyList<CourtRateWindow> rates,
        TimeZoneInfo zone,
        string timeZoneId,
        DateOnly date,
        decimal hourlyRate,
        int minutes)
    {
        var nowUtc = DateTime.UtcNow;
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone);
        var slots = new List<SuggestedCourtSlot>();
        var tooLate = 0;
        foreach (var court in courts.OrderBy(item => item.CourtNumber))
        {
            var cursor = DateOnly.FromDateTime(nowLocal) == date
                ? Minute(nowLocal.AddMinutes(1))
                : date.ToDateTime(new TimeOnly(8, 0));
            if (cursor <= nowLocal)
            {
                cursor = Minute(nowLocal.AddMinutes(1));
            }

            SuggestedCourtSlot? slot = null;
            for (var attempt = 0; attempt < 24 && slot is null; attempt++)
            {
                if (DateOnly.FromDateTime(cursor) != date)
                {
                    tooLate++;
                    break;
                }

                var endLocal = cursor.AddMinutes(minutes);
                if (endLocal.Date != cursor.Date)
                {
                    tooLate++;
                    break;
                }

                var startUtc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(cursor, DateTimeKind.Unspecified), zone);
                var endUtc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(endLocal, DateTimeKind.Unspecified), zone);
                var busyUntil = BusyUntilLocal(court.Id, startUtc, endUtc, sessions, closures, socials, courts, timeZoneId, zone);
                if (busyUntil is null || busyUntil <= cursor)
                {
                    var price = decimal.Round(CourtRates.Quote(zone.Id, hourlyRate, startUtc, endUtc, rates.ToArray()), 2, MidpointRounding.AwayFromZero);
                    var name = string.IsNullOrWhiteSpace(court.CourtName) ? $"Court {court.CourtNumber}" : court.CourtName.Trim();
                    var window = $"{cursor.ToString("h:mm tt", CultureInfo.InvariantCulture)}–{endLocal.ToString("h:mm tt", CultureInfo.InvariantCulture)}";
                    slot = new SuggestedCourtSlot(
                        court.Id,
                        name,
                        court.CourtNumber,
                        date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                        date.ToString("dddd, d MMMM yyyy", CultureInfo.InvariantCulture),
                        cursor.ToString("HH:mm", CultureInfo.InvariantCulture),
                        endLocal.ToString("HH:mm", CultureInfo.InvariantCulture),
                        window,
                        price,
                        startUtc > nowUtc.AddHours(24));
                    break;
                }

                var next = Minute(busyUntil.Value.AddMinutes(1));
                cursor = next <= cursor ? cursor.AddMinutes(15) : next;
            }

            if (slot is not null)
            {
                slots.Add(slot);
            }
        }

        var sharedWindow = slots.Select(item => item.WindowLabel).Distinct(StringComparer.Ordinal).Take(2).Count() == 1
            ? slots[0].WindowLabel
            : null;
        var recommendation = slots.Count == 0
            ? tooLate > 0
                ? "Please choose a shorter time. That length runs past the end of the day on the courts that are still open."
                : "Please try another time. No court is free for that length."
            : "Please choose a court.";
        return new AnchoredWindow(slots, sharedWindow, null, recommendation);
    }

    private static DateTime Minute(DateTime value) =>
        new(value.Year, value.Month, value.Day, value.Hour, value.Minute, 0);

    private static DateTime? BusyUntilLocal(
        Guid courtId,
        DateTime startUtc,
        DateTime endUtc,
        IReadOnlyList<SupportSessionRow> sessions,
        IReadOnlyList<PublicClosureRow> closures,
        IReadOnlyList<SocialBlockRow> socials,
        IReadOnlyList<PublicCourtRow> courts,
        string timeZoneId,
        TimeZoneInfo zone)
    {
        DateTime? until = null;
        void Later(DateTime local)
        {
            if (until is null || local > until)
            {
                until = local;
            }
        }

        foreach (var session in sessions)
        {
            if (session.CourtId == courtId && session.Taken > 0 && Overlaps(session.StartTime, session.EndTime, startUtc, endUtc))
            {
                Later(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(session.EndTime, DateTimeKind.Utc), zone));
            }
        }

        foreach (var closure in closures)
        {
            if ((closure.CourtId is null || closure.CourtId == courtId) && Overlaps(closure.StartTime, closure.EndTime, startUtc, endUtc))
            {
                Later(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(closure.EndTime, DateTimeKind.Utc), zone));
            }
        }

        var socialEnd = BookingRepository.SocialReserveEndUtc(socials, courts, courtId, timeZoneId, startUtc, endUtc);
        if (socialEnd is not null)
        {
            Later(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(socialEnd.Value, DateTimeKind.Utc), zone));
        }

        return until;
    }

    internal static string DurationLabel(int minutes) => minutes switch
    {
        30 => "30 minutes",
        60 => "1 hour",
        90 => "1 hour 30 minutes",
        120 => "2 hours",
        150 => "2 hours 30 minutes",
        _ => "3 hours",
    };

    internal static string? GetBlockReason(
        Guid courtId,
        DateTime startUtc,
        DateTime endUtc,
        IReadOnlyList<SupportSessionRow> sessions,
        IReadOnlyList<PublicClosureRow> closures,
        TimeZoneInfo zone)
    {
        var closure = closures.FirstOrDefault(item =>
            (item.CourtId is null || item.CourtId == courtId)
            && Overlaps(item.StartTime, item.EndTime, startUtc, endUtc));
        if (closure is not null)
        {
            return $"Closed {FormatClock(closure.StartTime, zone)}–{FormatClock(closure.EndTime, zone)}";
        }

        foreach (var session in sessions.Where(item => item.CourtId == courtId && Overlaps(item.StartTime, item.EndTime, startUtc, endUtc)))
        {
            var exact = SameInstant(session.StartTime, startUtc) && SameInstant(session.EndTime, endUtc);
            if (exact && session.Taken == 0)
            {
                continue;
            }

            return $"Booked {FormatClock(session.StartTime, zone)}–{FormatClock(session.EndTime, zone)}";
        }

        return null;
    }

    internal static bool TryGetZone(string timeZone, out TimeZoneInfo zone)
    {
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            zone = TimeZoneInfo.Utc;
            return false;
        }
    }

    internal static DateOnly ResolveDate(string? rawDate, TimeZoneInfo zone)
    {
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        if (string.IsNullOrWhiteSpace(rawDate))
        {
            return today;
        }

        var trimmed = rawDate.Trim();
        if (trimmed.Equals("today", StringComparison.OrdinalIgnoreCase))
        {
            return today;
        }

        if (trimmed.Equals("tomorrow", StringComparison.OrdinalIgnoreCase))
        {
            return today.AddDays(1);
        }

        if (DateOnly.TryParseExact(trimmed, ["yyyy-MM-dd", "dddd, d MMMM yyyy", "d MMMM yyyy"], CultureInfo.InvariantCulture, DateTimeStyles.None, out var exact))
        {
            return exact;
        }

        return DateOnly.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : today;
    }

    internal static DateOnly? DateChosenByPlayer(string? said, TimeZoneInfo zone)
    {
        if (string.IsNullOrWhiteSpace(said))
        {
            return null;
        }

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        DateOnly? chosen = null;
        var at = -1;
        void Take(int index, DateOnly value)
        {
            if (index < at)
            {
                return;
            }

            at = index;
            chosen = value;
        }

        var tomorrow = said.LastIndexOf("tomorrow", StringComparison.OrdinalIgnoreCase);
        if (tomorrow >= 0)
        {
            Take(tomorrow, today.AddDays(1));
        }

        var todayAt = said.LastIndexOf("today", StringComparison.OrdinalIgnoreCase);
        if (todayAt >= 0)
        {
            Take(todayAt, today);
        }

        foreach (Match match in Regex.Matches(said, @"\b\d{4}-\d{2}-\d{2}\b"))
        {
            if (DateOnly.TryParseExact(match.Value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var iso))
            {
                Take(match.Index, iso);
            }
        }

        foreach (Match match in Regex.Matches(said, @"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{1,2} [A-Za-z]+ \d{4}\b"))
        {
            if (DateOnly.TryParseExact(match.Value, "dddd, d MMMM yyyy", CultureInfo.InvariantCulture, DateTimeStyles.None, out var english))
            {
                Take(match.Index, english);
            }
        }

        return chosen;
    }

    internal static bool TryParseClockFlexible(string? raw, out TimeOnly time)
    {
        time = default;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        var clean = raw.Trim();
        if (TimeOnly.TryParseExact(clean, ["HH:mm", "H:mm", "h:mm tt", "htt", "h tt"], CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out time))
        {
            return true;
        }

        if (SupportEndpoints.TryReadWindow($"{clean} to {clean}", out var parsedStart, out _))
        {
            time = parsedStart;
            return true;
        }

        return TimeOnly.TryParse(clean, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out time);
    }

    internal static string? ReadString(JsonElement args, string property) =>
        args.ValueKind == JsonValueKind.Object
        && args.TryGetProperty(property, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    internal static int? ReadInt(JsonElement args, string property)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(property, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var num))
        {
            return num;
        }

        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed;
        }

        return null;
    }

    internal static bool? ReadBool(JsonElement args, string property)
    {
        if (args.ValueKind != JsonValueKind.Object || !args.TryGetProperty(property, out var value))
        {
            return null;
        }

        if (value.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            return value.GetBoolean();
        }

        if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var parsed))
        {
            return parsed;
        }

        return null;
    }

    internal static string FormatClock(DateTime utc, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone)
            .ToString("h:mm tt", CultureInfo.InvariantCulture);

    private static bool Overlaps(DateTime leftStart, DateTime leftEnd, DateTime rightStart, DateTime rightEnd) =>
        DateTime.SpecifyKind(leftStart, DateTimeKind.Utc) < DateTime.SpecifyKind(rightEnd, DateTimeKind.Utc)
        && DateTime.SpecifyKind(leftEnd, DateTimeKind.Utc) > DateTime.SpecifyKind(rightStart, DateTimeKind.Utc);

    private static bool SameInstant(DateTime left, DateTime right) =>
        Math.Abs((DateTime.SpecifyKind(left, DateTimeKind.Utc) - DateTime.SpecifyKind(right, DateTimeKind.Utc)).TotalSeconds) < 1;
}
