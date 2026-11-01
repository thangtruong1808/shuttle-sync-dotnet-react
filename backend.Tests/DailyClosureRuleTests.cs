using System.Globalization;
using System.Text.Json;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Tests;

public class DailyClosureRuleTests
{
    private const string Zone = "Australia/Melbourne";

    private static DateTime Local(string value) =>
        TimeZoneInfo.ConvertTimeToUtc(
            DateTime.ParseExact(value, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
            TimeZoneInfo.FindSystemTimeZoneById(Zone));

    [Fact]
    public void OpenEndedMorningBlocksLaterMorningsOnly()
    {
        var from = new DateOnly(2026, 11, 2);
        var start = new TimeOnly(0, 0);
        var end = new TimeOnly(7, 0);

        Assert.True(DailyClosureRules.HoursOverlap(from, null, start, end, Zone, Local("2026-11-02 06:00"), Local("2026-11-02 07:00")));
        Assert.True(DailyClosureRules.HoursOverlap(from, null, start, end, Zone, Local("2026-11-03 06:00"), Local("2026-11-03 07:00")));
        Assert.True(DailyClosureRules.HoursOverlap(from, null, start, end, Zone, Local("2026-11-03 06:30"), Local("2026-11-03 07:30")));
        Assert.False(DailyClosureRules.HoursOverlap(from, null, start, end, Zone, Local("2026-11-03 08:00"), Local("2026-11-03 09:00")));
        Assert.False(DailyClosureRules.HoursOverlap(from, null, start, end, Zone, Local("2026-11-01 06:00"), Local("2026-11-01 07:00")));
    }

    [Fact]
    public void ALaterToDateIsTheLastMorning()
    {
        var from = new DateOnly(2026, 11, 2);
        var until = new DateOnly(2030, 12, 2);
        var start = new TimeOnly(0, 0);
        var end = new TimeOnly(7, 0);

        Assert.True(DailyClosureRules.HoursOverlap(from, until, start, end, Zone, Local("2030-12-02 06:00"), Local("2030-12-02 07:00")));
        Assert.False(DailyClosureRules.HoursOverlap(from, until, start, end, Zone, Local("2030-12-03 06:30"), Local("2030-12-03 07:30")));
        Assert.False(DailyClosureRules.HoursOverlap(from, until, start, end, Zone, Local("2026-11-03 12:00"), Local("2026-11-03 13:00")));
    }

    [Fact]
    public void WebJsonKeepsTheEverydayFlag()
    {
        var json = """{"courtId":null,"date":"2026-11-02","toDate":"2026-11-02","start":"00:00","end":"07:00","reason":"Early morning","everyDay":true}""";
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var body = JsonSerializer.Deserialize<ClosureProbe>(json, options);
        Assert.NotNull(body);
        Assert.True(body!.EveryDay);
        Assert.Equal("2026-11-02", body.ToDate);
    }

    private sealed record ClosureProbe(Guid? CourtId, string? Date, string? Start, string? End, string? Reason, string? ToDate = null, bool EveryDay = false);
}
