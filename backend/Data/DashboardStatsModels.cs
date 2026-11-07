namespace ShuttleSync.Api.Data;

public sealed class StatsVenueOption
{
    public Guid Id { get; init; }
    public string Name { get; init; } = "";
    public string Slug { get; init; } = "";
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string TimeZone { get; init; } = "Australia/Melbourne";
    public string Currency { get; init; } = "AUD";
    public bool IsActive { get; init; }
    public int ActiveCourts { get; init; }
}

public sealed record StatsVenueScope(
    bool IsAllVenues,
    string SelectedVenueId,
    string SelectedVenueName,
    string TimeZone,
    string Currency,
    int ActiveCourts,
    Guid[] VenueIds,
    StatsVenueOption[] Venues);

public sealed record StatsPeriodWindow(
    string Period,
    DateOnly AnchorDate,
    DateOnly TodayLocal,
    DateOnly StartLocal,
    DateOnly EndLocalInclusive,
    DateOnly EndLocalExclusive,
    DateOnly PrevStartLocal,
    DateOnly PrevEndLocalInclusive,
    DateOnly PrevEndLocalExclusive,
    DateTime StartUtc,
    DateTime EndUtc,
    DateTime PrevStartUtc,
    DateTime PrevEndUtc,
    string DateRangeLabel,
    string PreviousDateRangeLabel,
    bool IsPartialPeriod,
    int ElapsedDays,
    int TotalDays,
    int TzOffsetMinutes,
    TimeZoneInfo Zone);

public sealed record MetricDelta(
    decimal Current,
    decimal? Previous,
    decimal? DeltaPercent,
    string Trend);

public sealed record UtilizationMetric(
    decimal Current,
    decimal? Previous,
    decimal? DeltaPercent,
    string Trend,
    decimal BookedHours,
    decimal AvailableHours,
    decimal? PreviousBookedHours,
    decimal? PreviousAvailableHours);

public sealed record RateMetric(
    decimal Current,
    decimal? Previous,
    decimal? DeltaPercent,
    string Trend,
    int Count,
    int Denominator);

public sealed record RetentionOverviewMetric(
    int NewPlayers,
    int ReturningPlayers,
    int TotalPlayers,
    decimal ReturningRatePercent,
    decimal? PreviousReturningRatePercent,
    decimal? DeltaPercent,
    string Trend);

public sealed record StatsOverviewResult(
    StatsVenueOption[] Venues,
    string SelectedVenueId,
    string SelectedVenueName,
    bool IsAllVenues,
    string TimeZone,
    string Currency,
    int ActiveCourts,
    string Period,
    string AnchorDate,
    string StartDate,
    string EndDate,
    string DateRangeLabel,
    string PreviousDateRangeLabel,
    bool IsPartialPeriod,
    int ElapsedDays,
    int TotalDays,
    bool Compare,
    bool HasCurrentData,
    bool HasPreviousData,
    MetricDelta TotalBookings,
    int CourtBookings,
    int SocialBookings,
    MetricDelta TotalRevenue,
    decimal CourtRevenue,
    decimal SocialRevenue,
    decimal DiscountsGranted,
    MetricDelta AvgRevenuePerBooking,
    UtilizationMetric CourtUtilization,
    RateMetric CancellationRate,
    RateMetric RescheduleRate,
    RetentionOverviewMetric PlayerRetention);

public sealed record TrendBucketDto(
    int Index,
    string Key,
    string Label,
    string ShortLabel,
    int Bookings,
    int CourtBookings,
    int SocialBookings,
    decimal Revenue,
    decimal BookedHours,
    string? PreviousLabel,
    int? PreviousBookings,
    decimal? PreviousRevenue);

public sealed record StatsTrendsResult(
    string Period,
    string DateRangeLabel,
    string PreviousDateRangeLabel,
    bool Compare,
    bool HasCurrentData,
    bool HasPreviousData,
    int TotalBookings,
    decimal TotalRevenue,
    int? PreviousTotalBookings,
    decimal? PreviousTotalRevenue,
    TrendBucketDto[] Buckets);

public sealed record DayDemandDto(
    int DayIndex,
    string ShortName,
    string FullName,
    int Bookings,
    decimal BookedHours,
    decimal Revenue,
    decimal SharePercent,
    bool IsPeak);

public sealed record HeatmapCellDto(
    int DayIndex,
    string DayShort,
    string DayFull,
    int Hour,
    string TimeLabel,
    int Bookings,
    decimal BookedHours,
    decimal Revenue,
    decimal Intensity);

public sealed record SlotHighlightDto(
    int DayIndex,
    string DayName,
    string ShortDay,
    int Hour,
    string TimeLabel,
    int Bookings,
    decimal BookedHours,
    decimal Revenue,
    string Suggestion);

public sealed record CourtUtilizationDto(
    Guid CourtId,
    Guid VenueId,
    string VenueName,
    string CourtName,
    int CourtNumber,
    string SurfaceType,
    bool IsActive,
    int Bookings,
    decimal BookedHours,
    decimal AvailableHours,
    decimal UtilizationPercent,
    decimal Revenue);

public sealed record StatsDemandResult(
    bool HasData,
    int TotalBookings,
    DayDemandDto? BusiestDay,
    DayDemandDto[] DayOfWeek,
    HeatmapCellDto[] Heatmap,
    SlotHighlightDto[] PeakSlots,
    SlotHighlightDto[] QuietSlots,
    CourtUtilizationDto[] CourtUtilization);

public sealed record PlayerRetentionDetailDto(
    int NewPlayers,
    int ReturningPlayers,
    int TotalUniquePlayers,
    decimal NewSharePercent,
    decimal ReturningSharePercent,
    int RepeatHoldBookings,
    int SeriesBookings);

public sealed record TopPlayerDto(
    int Rank,
    Guid UserId,
    string DisplayName,
    string Email,
    string Initials,
    int BookingsCount,
    int CourtBookingsCount,
    int SocialBookingsCount,
    decimal BookedHours,
    decimal TotalSpend,
    string LastBookingAt,
    bool IsReturning);

public sealed record PaymentStatusBreakdownDto(
    string Status,
    string Label,
    int Count,
    decimal GrossAmount,
    decimal RefundedAmount,
    decimal NetAmount,
    decimal SharePercent);

public sealed record ChannelBreakdownDto(
    string Channel,
    string Label,
    int BookingsCount,
    decimal Revenue,
    decimal SharePercent);

public sealed record StatsPlayersResult(
    bool HasData,
    PlayerRetentionDetailDto Retention,
    TopPlayerDto[] TopPlayers,
    PaymentStatusBreakdownDto[] PaymentBreakdown,
    ChannelBreakdownDto[] ChannelBreakdown);

internal sealed record PeriodSnapshot(
    int TotalBookings,
    int CourtBookings,
    int SocialBookings,
    decimal TotalRevenue,
    decimal CourtRevenue,
    decimal SocialRevenue,
    decimal DiscountsGranted,
    decimal AvgRevenuePerBooking,
    decimal BookedHours,
    decimal AvailableHours,
    decimal UtilizationPercent,
    int CancelledCount,
    int CommittedAndCancelledCount,
    decimal CancellationRatePercent,
    int RescheduledCount,
    decimal RescheduleRatePercent,
    int NewPlayers,
    int ReturningPlayers);

internal sealed record DailyPoint(
    int CourtBookings,
    int SocialBookings,
    int TotalBookings,
    decimal TotalRevenue,
    decimal BookedHours);

internal sealed class BookingAggRow
{
    public int ConfirmedBookings { get; init; }
    public int CancelledBookings { get; init; }
    public int RescheduleTopupCancelled { get; init; }
    public decimal CourtRevenue { get; init; }
    public decimal DiscountsGranted { get; init; }
    public decimal BookedCourtHours { get; init; }
    public DateTime? LatestBookedStartUtc { get; init; }
}

internal sealed class SocialAggRow
{
    public int ConfirmedSocials { get; init; }
    public int CancelledSocials { get; init; }
    public decimal SocialRevenue { get; init; }
}

internal sealed class RetentionAggRow
{
    public int NewPlayers { get; init; }
    public int ReturningPlayers { get; init; }
}

internal sealed class DailyClosureWindowRow
{
    public Guid? CourtId { get; init; }
    public DateTime FromDate { get; init; }
    public DateTime? UntilDate { get; init; }
    public decimal StartHour { get; init; }
    public decimal EndHour { get; init; }
}

internal sealed class DailyActivitySqlRow
{
    public DateTime LocalDay { get; init; }
    public int CourtBookings { get; init; }
    public int SocialBookings { get; init; }
    public decimal CourtRevenue { get; init; }
    public decimal SocialRevenue { get; init; }
    public decimal BookedHours { get; init; }
}

internal sealed class SlotDemandSqlRow
{
    public int DayIndex { get; init; }
    public int HourOfDay { get; init; }
    public int Bookings { get; init; }
    public decimal BookedHours { get; init; }
    public decimal Revenue { get; init; }
}

internal sealed class CourtDemandSqlRow
{
    public Guid CourtId { get; init; }
    public Guid VenueId { get; init; }
    public string VenueName { get; init; } = "";
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string? SurfaceType { get; init; }
    public bool IsActive { get; init; }
    public int Bookings { get; init; }
    public decimal BookedHours { get; init; }
    public decimal Revenue { get; init; }
}

internal sealed class TopPlayerSqlRow
{
    public Guid UserId { get; init; }
    public string? DisplayName { get; init; }
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public string Email { get; init; } = "";
    public int CourtBookings { get; init; }
    public int SocialBookings { get; init; }
    public int TotalBookings { get; init; }
    public decimal BookedHours { get; init; }
    public decimal TotalSpend { get; init; }
    public DateTime LastBookingUtc { get; init; }
    public DateTime? FirstBookingEverUtc { get; init; }
}

internal sealed class ChannelAggSqlRow
{
    public int SeriesBookings { get; init; }
    public decimal SeriesRevenue { get; init; }
    public int PromoRewardBookings { get; init; }
    public decimal PromoRewardRevenue { get; init; }
    public int StandardBookings { get; init; }
    public decimal StandardRevenue { get; init; }
    public int RepeatHoldBookings { get; init; }
}

internal sealed class PaymentStatusSqlRow
{
    public string Status { get; init; } = "";
    public int PaymentCount { get; init; }
    public decimal GrossAmount { get; init; }
    public decimal RefundedAmount { get; init; }
}

