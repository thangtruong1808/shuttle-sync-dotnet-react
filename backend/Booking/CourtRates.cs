namespace ShuttleSync.Api.Booking;

public sealed class CourtRateWindow
{
    public int DaysMask { get; set; }
    public int StartMinute { get; set; }
    public int EndMinute { get; set; }
    public decimal HourlyRate { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public static class CourtRates
{
    public static decimal Quote(string timeZoneId, decimal baseHourlyRate, DateTime startUtc, DateTime endUtc, IReadOnlyList<CourtRateWindow> windows)
    {
        if (!TryZone(timeZoneId, out var zone))
        {
            return Flat(baseHourlyRate, startUtc, endUtc);
        }

        var start = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
        var end = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc), zone);
        if (end <= start)
        {
            return 0;
        }

        decimal amount = 0;
        var cursor = start;
        while (cursor < end)
        {
            var midnight = cursor.Date.AddDays(1);
            var sliceEnd = end < midnight ? end : midnight;
            amount += QuoteSlice(cursor, sliceEnd, baseHourlyRate, windows);
            cursor = sliceEnd;
        }

        return decimal.Round(amount, 2, MidpointRounding.AwayFromZero);
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

    private static decimal QuoteSlice(DateTime start, DateTime end, decimal baseHourlyRate, IReadOnlyList<CourtRateWindow> windows)
    {
        var fromMinute = (int)start.TimeOfDay.TotalMinutes;
        var toMinute = end.Date > start.Date ? 24 * 60 : (int)end.TimeOfDay.TotalMinutes;
        if (toMinute <= fromMinute)
        {
            return 0;
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
        decimal amount = 0;
        for (var index = 0; index < points.Length - 1; index++)
        {
            var from = points[index];
            var to = points[index + 1];
            var rate = baseHourlyRate;
            var latest = DateTime.MinValue;
            foreach (var window in windows)
            {
                if ((window.DaysMask & bit) == 0 || window.StartMinute > from || window.EndMinute < to || window.UpdatedAt < latest)
                {
                    continue;
                }

                latest = window.UpdatedAt;
                rate = window.HourlyRate;
            }

            amount += rate * (to - from) / 60m;
        }

        return amount;
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
