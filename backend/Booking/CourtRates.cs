namespace ShuttleSync.Api.Booking;

public sealed class CourtRateWindow
{
    public int DaysMask { get; set; }
    public int StartMinute { get; set; }
    public int EndMinute { get; set; }
    public decimal HourlyRate { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public sealed record CourtRateLine(int Minutes, decimal HourlyRate, decimal Amount, bool Scheduled, int DaysMask, int StartMinute, int EndMinute);

public static class CourtRates
{
    public static decimal Quote(string timeZoneId, decimal baseHourlyRate, DateTime startUtc, DateTime endUtc, IReadOnlyList<CourtRateWindow> windows)
    {
        if (!TryZone(timeZoneId, out _))
        {
            return Flat(baseHourlyRate, startUtc, endUtc);
        }

        return decimal.Round(Collect(timeZoneId, baseHourlyRate, startUtc, endUtc, windows).Sum(line => line.Amount), 2, MidpointRounding.AwayFromZero);
    }

    public static IReadOnlyList<CourtRateLine> Present(IEnumerable<CourtRateLine> raw)
    {
        var merged = raw
            .GroupBy(line => line.Scheduled
                ? $"s|{line.DaysMask}|{line.StartMinute}|{line.EndMinute}|{line.HourlyRate}"
                : $"b|{line.HourlyRate}")
            .Select(group =>
            {
                var first = group.First();
                return first with { Minutes = group.Sum(line => line.Minutes), Amount = group.Sum(line => line.Amount) };
            })
            .Where(line => line.Minutes > 0)
            .ToList();
        if (merged.Count == 0)
        {
            return merged;
        }

        var target = decimal.Round(merged.Sum(line => line.Amount), 2, MidpointRounding.AwayFromZero);
        decimal running = 0;
        for (var index = 0; index < merged.Count; index++)
        {
            var rounded = index == merged.Count - 1
                ? target - running
                : decimal.Round(merged[index].Amount, 2, MidpointRounding.AwayFromZero);
            running += rounded;
            merged[index] = merged[index] with { Amount = rounded };
        }

        return merged;
    }

    public static List<CourtRateLine> Collect(string timeZoneId, decimal baseHourlyRate, DateTime startUtc, DateTime endUtc, IReadOnlyList<CourtRateWindow> windows)
    {
        var lines = new List<CourtRateLine>();
        if (!TryZone(timeZoneId, out var zone))
        {
            return lines;
        }

        var start = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
        var end = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc), zone);
        if (end <= start)
        {
            return lines;
        }

        var cursor = start;
        while (cursor < end)
        {
            var midnight = cursor.Date.AddDays(1);
            var sliceEnd = end < midnight ? end : midnight;
            lines.AddRange(Slice(cursor, sliceEnd, baseHourlyRate, windows));
            cursor = sliceEnd;
        }

        return lines;
    }

    public static bool UsesWindow(string timeZoneId, DateTime startUtc, DateTime endUtc, IReadOnlyList<CourtRateWindow> windows)
    {
        if (windows.Count == 0 || !TryZone(timeZoneId, out var zone))
        {
            return false;
        }

        var start = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
        var end = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc), zone);
        var cursor = start;
        while (cursor < end)
        {
            var midnight = cursor.Date.AddDays(1);
            var sliceEnd = end < midnight ? end : midnight;
            var bit = DayBit(cursor.DayOfWeek);
            var from = (int)cursor.TimeOfDay.TotalMinutes;
            var to = sliceEnd.Date > cursor.Date ? 24 * 60 : (int)sliceEnd.TimeOfDay.TotalMinutes;
            if (windows.Any(window => (window.DaysMask & bit) != 0 && window.StartMinute < to && window.EndMinute > from))
            {
                return true;
            }

            cursor = sliceEnd;
        }

        return false;
    }

    private static IEnumerable<CourtRateLine> Slice(DateTime start, DateTime end, decimal baseHourlyRate, IReadOnlyList<CourtRateWindow> windows)
    {
        var fromMinute = (int)start.TimeOfDay.TotalMinutes;
        var toMinute = end.Date > start.Date ? 24 * 60 : (int)end.TimeOfDay.TotalMinutes;
        if (toMinute <= fromMinute)
        {
            yield break;
        }

        var bit = DayBit(start.DayOfWeek);
        var cuts = new SortedSet<int> { fromMinute, toMinute };
        foreach (var window in windows)
        {
            if ((window.DaysMask & bit) == 0)
            {
                continue;
            }

            if (window.StartMinute > fromMinute && window.StartMinute < toMinute)
            {
                cuts.Add(window.StartMinute);
            }

            if (window.EndMinute > fromMinute && window.EndMinute < toMinute)
            {
                cuts.Add(window.EndMinute);
            }
        }

        var points = cuts.ToArray();
        for (var index = 0; index < points.Length - 1; index++)
        {
            var from = points[index];
            var to = points[index + 1];
            var rate = baseHourlyRate;
            CourtRateWindow? winner = null;
            var latest = DateTime.MinValue;
            foreach (var window in windows)
            {
                if ((window.DaysMask & bit) == 0 || window.StartMinute > from || window.EndMinute < to || window.UpdatedAt < latest)
                {
                    continue;
                }

                latest = window.UpdatedAt;
                rate = window.HourlyRate;
                winner = window;
            }

            var minutes = to - from;
            if (winner is null && minutes == 1)
            {
                winner = windows
                    .Where(window => (window.DaysMask & bit) != 0 && window.EndMinute == from)
                    .OrderByDescending(window => window.UpdatedAt)
                    .FirstOrDefault();
                if (winner is not null)
                {
                    rate = winner.HourlyRate;
                }
            }

            var amount = rate * minutes / 60m;
            yield return winner is null
                ? new CourtRateLine(minutes, rate, amount, false, 0, 0, 0)
                : new CourtRateLine(minutes, rate, amount, true, winner.DaysMask, winner.StartMinute, winner.EndMinute);
        }
    }

    private static int DayBit(DayOfWeek day) => 1 << (day == DayOfWeek.Sunday ? 6 : (int)day - 1);

    private static decimal Flat(decimal hourlyRate, DateTime startUtc, DateTime endUtc) =>
        hourlyRate <= 0 || endUtc <= startUtc
            ? 0
            : decimal.Round(hourlyRate * (decimal)(endUtc - startUtc).TotalMinutes / 60m, 2, MidpointRounding.AwayFromZero);

    private static bool TryZone(string timeZoneId, out TimeZoneInfo zone)
    {
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            zone = TimeZoneInfo.Utc;
            return false;
        }
    }
}
