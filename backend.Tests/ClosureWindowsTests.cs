using ShuttleSync.Api.Booking;

namespace ShuttleSync.Api.Tests;

public class ClosureWindowsTests
{
    private const string Zone = "Australia/Melbourne";

    [Fact]
    public void EveryDayClosesTheSameHoursOnEachDate()
    {
        var ok = VenueClock.TryGetClosureWindows(Zone, "2026-11-01", "2026-11-03", "00:00", "07:00", true, out var windows, out var error);

        Assert.True(ok, error);
        Assert.Equal(3, windows.Count);
        Assert.All(windows, window => Assert.Equal(TimeSpan.FromHours(7), window.EndUtc - window.StartUtc));
        Assert.Equal(windows[0].StartUtc.AddDays(1), windows[1].StartUtc);
    }

    [Fact]
    public void ADateRangeWithoutEveryDayIsOneContinuousBlock()
    {
        var ok = VenueClock.TryGetClosureWindows(Zone, "2026-11-01", "2026-11-03", "00:00", "07:00", false, out var windows, out var error);

        Assert.True(ok, error);
        Assert.Single(windows);
        Assert.True(windows[0].EndUtc - windows[0].StartUtc > TimeSpan.FromDays(1));
    }
}
