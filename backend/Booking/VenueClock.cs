namespace ShuttleSync.Api.Booking;

public static class VenueClock
{
    public static bool TryGetDayWindow(
        string timeZoneId,
        string? date,
        string? from,
        string? to,
        out DayWindow window,
        out string error)
    {
        window = default;
        error = "";
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            error = "This venue timezone is not available on the server.";
            return false;
        }

        var localDate = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        if (!string.IsNullOrWhiteSpace(date))
        {
            if (!DateOnly.TryParse(date, out localDate))
            {
                error = "Choose a valid date.";
                return false;
            }
        }

        if (!TryParseClock(from, out var fromClock, out error) || !TryParseClock(to, out var toClock, out error))
        {
            return false;
        }

        if (fromClock is not null && toClock is not null && toClock <= fromClock)
        {
            error = "The end time must be later than the start time.";
            return false;
        }

        var startLocal = localDate.ToDateTime(fromClock ?? TimeOnly.MinValue);
        var endLocal = toClock is null
            ? localDate.AddDays(1).ToDateTime(TimeOnly.MinValue)
            : localDate.ToDateTime(toClock.Value);
        window = new DayWindow(
            localDate.ToString("yyyy-MM-dd"),
            TimeZoneInfo.ConvertTimeToUtc(startLocal, zone),
            TimeZoneInfo.ConvertTimeToUtc(endLocal, zone));
        return true;
    }

    public static bool TryGetClosureWindows(
        string timeZoneId,
        string? fromDate,
        string? toDate,
        string? start,
        string? end,
        bool everyDay,
        out IReadOnlyList<DayWindow> windows,
        out string error)
    {
        windows = [];
        error = "";
        if (string.IsNullOrWhiteSpace(fromDate) || !DateOnly.TryParse(fromDate, out var from))
        {
            error = "Choose a from date.";
            return false;
        }

        var to = from;
        if (!string.IsNullOrWhiteSpace(toDate))
        {
            if (!DateOnly.TryParse(toDate, out to))
            {
                error = "Choose a to date.";
                return false;
            }
        }

        if (to < from)
        {
            error = "The to date must be on or after the from date.";
            return false;
        }

        var dayCount = to.DayNumber - from.DayNumber + 1;
        if (!everyDay)
        {
            if (from == to)
            {
                if (!TryGetDayWindow(timeZoneId, from.ToString("yyyy-MM-dd"), start, end, out var sameDay, out error))
                {
                    return false;
                }

                windows = [sameDay];
                return true;
            }

            return TryGetSpan(timeZoneId, from, to, start, end, out windows, out error);
        }

        if (dayCount > 366)
        {
            error = "Every day can cover up to 366 days.";
            return false;
        }

        var daily = new List<DayWindow>(dayCount);
        for (var day = from; day <= to; day = day.AddDays(1))
        {
            if (!TryGetDayWindow(timeZoneId, day.ToString("yyyy-MM-dd"), start, end, out var window, out error))
            {
                return false;
            }

            daily.Add(window);
        }

        windows = daily;
        return true;
    }

    private static bool TryGetSpan(
        string timeZoneId,
        DateOnly from,
        DateOnly to,
        string? start,
        string? end,
        out IReadOnlyList<DayWindow> windows,
        out string error)
    {
        windows = [];
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            error = "This venue timezone is not available on the server.";
            return false;
        }

        if (!TryParseClock(start, out var fromClock, out error) || fromClock is null)
        {
            error = string.IsNullOrWhiteSpace(error) ? "Choose a start time." : error;
            return false;
        }

        if (!TryParseClock(end, out var toClock, out error) || toClock is null)
        {
            error = string.IsNullOrWhiteSpace(error) ? "Choose an end time." : error;
            return false;
        }

        try
        {
            var startUtc = TimeZoneInfo.ConvertTimeToUtc(from.ToDateTime(fromClock.Value), zone);
            var endUtc = TimeZoneInfo.ConvertTimeToUtc(to.ToDateTime(toClock.Value), zone);
            if (endUtc <= startUtc)
            {
                error = "The end time must be later than the start time.";
                return false;
            }

            windows = [new DayWindow(from.ToString("yyyy-MM-dd"), startUtc, endUtc)];
            return true;
        }
        catch (ArgumentException)
        {
            error = "Choose a valid date and time.";
            return false;
        }
    }

    public static DateTimeOffset AsUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    public static bool TryShiftDays(string timeZoneId, DateTime startUtc, DateTime endUtc, int days, out DateTime nextStartUtc, out DateTime nextEndUtc)
    {
        nextStartUtc = default;
        nextEndUtc = default;
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }

        try
        {
            var startLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
            var endLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc), zone);
            nextStartUtc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(startLocal.AddDays(days), DateTimeKind.Unspecified), zone);
            nextEndUtc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(endLocal.AddDays(days), DateTimeKind.Unspecified), zone);
        }
        catch (ArgumentException)
        {
            return false;
        }

        return nextEndUtc > nextStartUtc;
    }

    private static bool TryParseClock(string? value, out TimeOnly? clock, out string error)
    {
        clock = null;
        error = "";
        if (string.IsNullOrWhiteSpace(value))
        {
            return true;
        }

        if (!TimeOnly.TryParse(value, out var parsed))
        {
            error = "Use a time like 18:00.";
            return false;
        }

        clock = parsed;
        return true;
    }

    public readonly record struct DayWindow(string Date, DateTime StartUtc, DateTime EndUtc);
}
