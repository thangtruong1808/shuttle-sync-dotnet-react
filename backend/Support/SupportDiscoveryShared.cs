using System.Globalization;
using System.Text.Json;
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
        TimeOnly? preferredStart)
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

        var nowUtc = DateTime.UtcNow;
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
            if (startUtc <= nowUtc.AddMinutes(5))
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
                    MoreThan24HoursAway: startUtc > nowUtc.AddHours(24)));

                break;
            }

            if (results.Count >= 8)
            {
                break;
            }
        }

        return results;
    }

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

        return DateOnly.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : today;
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
