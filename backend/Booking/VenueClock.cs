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

    public static DateTimeOffset AsUtc(DateTime value) =>
        new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

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
