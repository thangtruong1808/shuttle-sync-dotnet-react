using System.Globalization;
using Dapper;
using MySqlConnector;
using ShuttleSync.Api.Booking;

namespace ShuttleSync.Api.Data;

public sealed partial class DashboardStatsRepository(IConfiguration configuration)
{
    private const int BookableHoursPerDay = 18; // 06:00 to 24:00

    public async Task<StatsVenueOption[]> ListAccessibleVenuesAsync(
        Guid userId,
        string role,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<StatsVenueOption>(
            new CommandDefinition(
                """
                SELECT v.Id,
                       v.Name,
                       v.Slug,
                       v.Suburb,
                       v.State,
                       v.TimeZone,
                       v.Currency,
                       v.IsActive,
                       (
                           SELECT CAST(COUNT(*) AS SIGNED)
                           FROM Courts c
                           WHERE c.VenueId = v.Id AND c.IsDeleted = 0 AND c.IsActive = 1
                       ) AS ActiveCourts
                FROM Venues v
                WHERE v.IsDeleted = 0
                  AND (
                      @Role = 'admin'
                      OR EXISTS (
                          SELECT 1
                          FROM UserVenues uv
                          WHERE uv.UserId = @UserId AND uv.VenueId = v.Id
                      )
                  )
                ORDER BY v.Name
                """,
                new { UserId = userId, Role = role },
                cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public static bool TryResolveScope(
        StatsVenueOption[] accessibleVenues,
        string? venueIdParam,
        out StatsVenueScope scope,
        out string error,
        out int statusCode)
    {
        scope = default!;
        error = "";
        statusCode = StatusCodes.Status200OK;

        if (accessibleVenues.Length == 0)
        {
            scope = new StatsVenueScope(
                IsAllVenues: true,
                SelectedVenueId: "all",
                SelectedVenueName: "All Venues",
                TimeZone: "Australia/Melbourne",
                Currency: "AUD",
                ActiveCourts: 0,
                VenueIds: [],
                Venues: []);
            return true;
        }

        var trimmed = (venueIdParam ?? "").Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            var first = accessibleVenues[0];
            scope = new StatsVenueScope(
                IsAllVenues: false,
                SelectedVenueId: first.Id.ToString(),
                SelectedVenueName: first.Name,
                TimeZone: string.IsNullOrWhiteSpace(first.TimeZone) ? "Australia/Melbourne" : first.TimeZone,
                Currency: string.IsNullOrWhiteSpace(first.Currency) ? "AUD" : first.Currency,
                ActiveCourts: first.ActiveCourts,
                VenueIds: [first.Id],
                Venues: accessibleVenues);
            return true;
        }

        if (trimmed.Equals("all", StringComparison.OrdinalIgnoreCase))
        {
            var primary = accessibleVenues[0];
            scope = new StatsVenueScope(
                IsAllVenues: true,
                SelectedVenueId: "all",
                SelectedVenueName: "All Venues",
                TimeZone: string.IsNullOrWhiteSpace(primary.TimeZone) ? "Australia/Melbourne" : primary.TimeZone,
                Currency: string.IsNullOrWhiteSpace(primary.Currency) ? "AUD" : primary.Currency,
                ActiveCourts: accessibleVenues.Sum(v => v.ActiveCourts),
                VenueIds: accessibleVenues.Select(v => v.Id).ToArray(),
                Venues: accessibleVenues);
            return true;
        }

        if (!Guid.TryParse(trimmed, out var parsedId))
        {
            error = "Choose a valid venue.";
            statusCode = StatusCodes.Status400BadRequest;
            return false;
        }

        var match = accessibleVenues.FirstOrDefault(v => v.Id == parsedId);
        if (match is null)
        {
            error = "You do not have access to statistics for that venue.";
            statusCode = StatusCodes.Status403Forbidden;
            return false;
        }

        scope = new StatsVenueScope(
            IsAllVenues: false,
            SelectedVenueId: match.Id.ToString(),
            SelectedVenueName: match.Name,
            TimeZone: string.IsNullOrWhiteSpace(match.TimeZone) ? "Australia/Melbourne" : match.TimeZone,
            Currency: string.IsNullOrWhiteSpace(match.Currency) ? "AUD" : match.Currency,
            ActiveCourts: match.ActiveCourts,
            VenueIds: [match.Id],
            Venues: accessibleVenues);
        return true;
    }

    public static bool TryResolvePeriod(
        string timeZoneId,
        string? periodParam,
        string? dateParam,
        string? fromParam,
        string? toParam,
        out StatsPeriodWindow window,
        out string error)
    {
        window = default!;
        error = "";

        var zone = ResolveTimeZone(timeZoneId);
        var nowUtc = DateTime.UtcNow;
        var todayLocal = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(nowUtc, zone));

        var normalizedPeriod = (periodParam ?? "monthly").Trim().ToLowerInvariant();
        if (normalizedPeriod is not ("weekly" or "monthly" or "quarterly" or "yearly"))
        {
            error = "Choose weekly, monthly, quarterly, or yearly.";
            return false;
        }

        var anchorDate = todayLocal;
        if (!string.IsNullOrWhiteSpace(dateParam))
        {
            if (!DateOnly.TryParseExact(dateParam.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out anchorDate))
            {
                error = "Use a valid date in YYYY-MM-DD format.";
                return false;
            }
        }

        DateOnly startLocal;
        DateOnly endLocalExclusive;
        DateOnly prevStartLocal;
        DateOnly prevEndLocalExclusive;

        if (!string.IsNullOrWhiteSpace(fromParam) && !string.IsNullOrWhiteSpace(toParam))
        {
            if (!DateOnly.TryParseExact(fromParam.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var customFrom)
                || !DateOnly.TryParseExact(toParam.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var customTo))
            {
                error = "Use valid from and to dates in YYYY-MM-DD format.";
                return false;
            }

            if (customTo < customFrom)
            {
                error = "The end date must be on or after the start date.";
                return false;
            }

            var spanDays = customTo.DayNumber - customFrom.DayNumber + 1;
            if (spanDays > 366)
            {
                error = "Custom date ranges can cover up to 366 days.";
                return false;
            }

            startLocal = customFrom;
            endLocalExclusive = customTo.AddDays(1);
            prevStartLocal = customFrom.AddDays(-spanDays);
            prevEndLocalExclusive = customFrom;
        }
        else
        {
            switch (normalizedPeriod)
            {
                case "weekly":
                {
                    var diffToMonday = ((int)anchorDate.DayOfWeek + 6) % 7;
                    startLocal = anchorDate.AddDays(-diffToMonday);
                    endLocalExclusive = startLocal.AddDays(7);
                    prevStartLocal = startLocal.AddDays(-7);
                    prevEndLocalExclusive = startLocal;
                    break;
                }
                case "quarterly":
                {
                    var quarterStartMonth = ((anchorDate.Month - 1) / 3) * 3 + 1;
                    startLocal = new DateOnly(anchorDate.Year, quarterStartMonth, 1);
                    endLocalExclusive = startLocal.AddMonths(3);
                    prevStartLocal = startLocal.AddMonths(-3);
                    prevEndLocalExclusive = startLocal;
                    break;
                }
                case "yearly":
                {
                    startLocal = new DateOnly(anchorDate.Year, 1, 1);
                    endLocalExclusive = startLocal.AddYears(1);
                    prevStartLocal = startLocal.AddYears(-1);
                    prevEndLocalExclusive = startLocal;
                    break;
                }
                default:
                {
                    startLocal = new DateOnly(anchorDate.Year, anchorDate.Month, 1);
                    endLocalExclusive = startLocal.AddMonths(1);
                    prevStartLocal = startLocal.AddMonths(-1);
                    prevEndLocalExclusive = startLocal;
                    break;
                }
            }
        }

        var endLocalInclusive = endLocalExclusive.AddDays(-1);
        var prevEndLocalInclusive = prevEndLocalExclusive.AddDays(-1);

        var startUtc = ToUtcSafe(startLocal, zone);
        var endUtc = ToUtcSafe(endLocalExclusive, zone);
        var prevStartUtc = ToUtcSafe(prevStartLocal, zone);
        var prevEndUtc = ToUtcSafe(prevEndLocalExclusive, zone);

        var totalDays = Math.Max(1, endLocalExclusive.DayNumber - startLocal.DayNumber);
        var isPartialPeriod = startLocal <= todayLocal && todayLocal < endLocalExclusive;
        var elapsedDays = isPartialPeriod
            ? Math.Clamp(todayLocal.DayNumber - startLocal.DayNumber + 1, 1, totalDays)
            : (todayLocal < startLocal ? 0 : totalDays);

        var midUtc = startUtc.AddTicks((endUtc - startUtc).Ticks / 2);
        var tzOffsetMinutes = (int)Math.Round(zone.GetUtcOffset(midUtc).TotalMinutes);

        window = new StatsPeriodWindow(
            Period: normalizedPeriod,
            AnchorDate: anchorDate,
            TodayLocal: todayLocal,
            StartLocal: startLocal,
            EndLocalInclusive: endLocalInclusive,
            EndLocalExclusive: endLocalExclusive,
            PrevStartLocal: prevStartLocal,
            PrevEndLocalInclusive: prevEndLocalInclusive,
            PrevEndLocalExclusive: prevEndLocalExclusive,
            StartUtc: startUtc,
            EndUtc: endUtc,
            PrevStartUtc: prevStartUtc,
            PrevEndUtc: prevEndUtc,
            DateRangeLabel: FormatDateRangeLabel(startLocal, endLocalInclusive),
            PreviousDateRangeLabel: FormatDateRangeLabel(prevStartLocal, prevEndLocalInclusive),
            IsPartialPeriod: isPartialPeriod,
            ElapsedDays: elapsedDays,
            TotalDays: totalDays,
            TzOffsetMinutes: tzOffsetMinutes,
            Zone: zone);
        return true;
    }

    public async Task<StatsOverviewResult> GetOverviewAsync(
        StatsVenueScope scope,
        StatsPeriodWindow window,
        bool compare,
        CancellationToken cancellationToken)
    {
        if (scope.VenueIds.Length == 0)
        {
            var emptySnap = EmptySnapshot();
            return BuildOverviewResult(scope, window, emptySnap, emptySnap, compare);
        }

        await using var connection = await OpenAsync(cancellationToken);
        var current = await QueryPeriodSnapshotAsync(
            connection,
            scope.VenueIds,
            scope.ActiveCourts,
            window.StartLocal,
            window.EndLocalExclusive,
            window.TodayLocal,
            window.StartUtc,
            window.EndUtc,
            window.TzOffsetMinutes,
            cancellationToken);

        var previous = compare
            ? await QueryPeriodSnapshotAsync(
                connection,
                scope.VenueIds,
                scope.ActiveCourts,
                window.PrevStartLocal,
                window.PrevEndLocalExclusive,
                window.TodayLocal,
                window.PrevStartUtc,
                window.PrevEndUtc,
                window.TzOffsetMinutes,
                cancellationToken)
            : EmptySnapshot();

        return BuildOverviewResult(scope, window, current, previous, compare);
    }

    private async Task<PeriodSnapshot> QueryPeriodSnapshotAsync(
        MySqlConnection connection,
        Guid[] venueIds,
        int activeCourtsCount,
        DateOnly startLocal,
        DateOnly endLocalExclusive,
        DateOnly todayLocal,
        DateTime startUtc,
        DateTime endUtc,
        int tzOffsetMinutes,
        CancellationToken cancellationToken)
    {
        var bookingAgg = await connection.QuerySingleAsync<BookingAggRow>(
            new CommandDefinition(
                """
                SELECT
                    CAST(COALESCE(SUM(CASE WHEN b.Status IN ('confirmed', 'completed') THEN 1 ELSE 0 END), 0) AS SIGNED) AS ConfirmedBookings,
                    CAST(COALESCE(SUM(CASE WHEN b.Status = 'cancelled' THEN 1 ELSE 0 END), 0) AS SIGNED) AS CancelledBookings,
                    CAST(COALESCE(SUM(CASE WHEN b.Status = 'cancelled' AND b.CancelReason LIKE 'week-topup|%' THEN 1 ELSE 0 END), 0) AS SIGNED) AS RescheduleTopupCancelled,
                    COALESCE(SUM(CASE WHEN b.Status IN ('confirmed', 'completed') THEN b.TotalAmount ELSE 0 END), 0) AS CourtRevenue,
                    COALESCE(SUM(CASE WHEN b.Status IN ('confirmed', 'completed') THEN b.DiscountAmount + b.PointsValue ELSE 0 END), 0) AS DiscountsGranted,
                    COALESCE(SUM(CASE WHEN b.Status IN ('confirmed', 'completed') THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, cs.StartTime, cs.EndTime)) / 60.0 ELSE 0 END), 0) AS BookedCourtHours,
                    MAX(CASE WHEN b.Status IN ('confirmed', 'completed') THEN cs.StartTime ELSE NULL END) AS LatestBookedStartUtc
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                WHERE b.VenueId IN @VenueIds
                  AND b.IsDeleted = 0
                  AND cs.IsDeleted = 0
                  AND cs.StartTime >= @StartUtc
                  AND cs.StartTime < @EndUtc
                """,
                new { VenueIds = venueIds, StartUtc = startUtc, EndUtc = endUtc },
                cancellationToken: cancellationToken));

        var socialAgg = await connection.QuerySingleAsync<SocialAggRow>(
            new CommandDefinition(
                """
                SELECT
                    CAST(COALESCE(SUM(CASE WHEN r.Status = 'confirmed' THEN 1 ELSE 0 END), 0) AS SIGNED) AS ConfirmedSocials,
                    CAST(COALESCE(SUM(CASE WHEN r.Status = 'cancelled' THEN 1 ELSE 0 END), 0) AS SIGNED) AS CancelledSocials,
                    COALESCE(SUM(CASE WHEN r.Status = 'confirmed' THEN s.Price * (
                        1 + (
                            SELECT COUNT(*)
                            FROM PublicSocialFriends f
                            WHERE f.RegistrationId = r.Id AND f.Status = 'confirmed'
                        )
                    ) ELSE 0 END), 0) AS SocialRevenue
                FROM PublicSocialRegistrations r
                JOIN PublicSocials s ON s.Id = r.SocialId
                WHERE r.VenueId IN @VenueIds
                  AND s.IsDeleted = 0
                  AND s.StartTime >= @StartUtc
                  AND s.StartTime < @EndUtc
                """,
                new { VenueIds = venueIds, StartUtc = startUtc, EndUtc = endUtc },
                cancellationToken: cancellationToken));

        var auditReschedules = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                """
                SELECT COUNT(*)
                FROM AuditLogs a
                WHERE a.VenueId IN @VenueIds
                  AND a.Action IN ('booking.week_rescheduled', 'booking.hours_changed')
                  AND a.CreatedAt >= @StartUtc
                  AND a.CreatedAt < @EndUtc
                """,
                new { VenueIds = venueIds, StartUtc = startUtc, EndUtc = endUtc },
                cancellationToken: cancellationToken));

        var retention = await QueryPlayerRetentionCountsAsync(
            connection,
            venueIds,
            startUtc,
            endUtc,
            cancellationToken);

        // Determine effective utilization window for partial in-progress periods.
        var effectiveEndLocal = endLocalExclusive;
        if (startLocal <= todayLocal && todayLocal < endLocalExclusive)
        {
            var minEndLocal = todayLocal.AddDays(1);
            if (bookingAgg.LatestBookedStartUtc is DateTime latestUtc)
            {
                var latestLocal = DateOnly.FromDateTime(latestUtc.AddMinutes(tzOffsetMinutes));
                var bookedNextDay = latestLocal.AddDays(1);
                if (bookedNextDay > minEndLocal)
                {
                    minEndLocal = bookedNextDay;
                }
            }

            effectiveEndLocal = minEndLocal < endLocalExclusive ? minEndLocal : endLocalExclusive;
        }

        var availableHours = await ComputeAvailableCourtHoursAsync(
            connection,
            venueIds,
            activeCourtsCount,
            startLocal,
            effectiveEndLocal,
            startUtc,
            endUtc,
            cancellationToken);

        var totalBookings = bookingAgg.ConfirmedBookings + socialAgg.ConfirmedSocials;
        var totalCancelled = Math.Max(0, bookingAgg.CancelledBookings - bookingAgg.RescheduleTopupCancelled) + socialAgg.CancelledSocials;
        var totalRevenue = decimal.Round(bookingAgg.CourtRevenue + socialAgg.SocialRevenue, 2);
        var avgRevenue = totalBookings > 0
            ? decimal.Round(totalRevenue / totalBookings, 2)
            : 0m;
        var bookedHours = decimal.Round(bookingAgg.BookedCourtHours, 2);
        var utilizationPercent = availableHours > 0m
            ? Math.Clamp(decimal.Round((bookedHours / availableHours) * 100m, 1), 0m, 100m)
            : 0m;

        var committedPlusCancelled = totalBookings + totalCancelled;
        var cancellationRate = committedPlusCancelled > 0
            ? Math.Clamp(decimal.Round(((decimal)totalCancelled / committedPlusCancelled) * 100m, 1), 0m, 100m)
            : 0m;

        var rescheduledCount = Math.Max(auditReschedules, bookingAgg.RescheduleTopupCancelled);
        var rescheduleDenominator = Math.Max(totalBookings, rescheduledCount);
        var rescheduleRate = rescheduleDenominator > 0
            ? Math.Clamp(decimal.Round(((decimal)rescheduledCount / rescheduleDenominator) * 100m, 1), 0m, 100m)
            : 0m;

        return new PeriodSnapshot(
            TotalBookings: totalBookings,
            CourtBookings: bookingAgg.ConfirmedBookings,
            SocialBookings: socialAgg.ConfirmedSocials,
            TotalRevenue: totalRevenue,
            CourtRevenue: decimal.Round(bookingAgg.CourtRevenue, 2),
            SocialRevenue: decimal.Round(socialAgg.SocialRevenue, 2),
            DiscountsGranted: decimal.Round(bookingAgg.DiscountsGranted, 2),
            AvgRevenuePerBooking: avgRevenue,
            BookedHours: bookedHours,
            AvailableHours: decimal.Round(availableHours, 2),
            UtilizationPercent: utilizationPercent,
            CancelledCount: totalCancelled,
            CommittedAndCancelledCount: committedPlusCancelled,
            CancellationRatePercent: cancellationRate,
            RescheduledCount: rescheduledCount,
            RescheduleRatePercent: rescheduleRate,
            NewPlayers: retention.NewPlayers,
            ReturningPlayers: retention.ReturningPlayers);
    }

    private async Task<(int NewPlayers, int ReturningPlayers)> QueryPlayerRetentionCountsAsync(
        MySqlConnection connection,
        Guid[] venueIds,
        DateTime startUtc,
        DateTime endUtc,
        CancellationToken cancellationToken)
    {
        var row = await connection.QuerySingleAsync<RetentionAggRow>(
            new CommandDefinition(
                """
                SELECT
                    CAST(COALESCE(SUM(CASE WHEN player_first.FirstStart >= @StartUtc THEN 1 ELSE 0 END), 0) AS SIGNED) AS NewPlayers,
                    CAST(COALESCE(SUM(CASE WHEN player_first.FirstStart < @StartUtc THEN 1 ELSE 0 END), 0) AS SIGNED) AS ReturningPlayers
                FROM (
                    SELECT active_players.UserId,
                           MIN(all_activity.StartTime) AS FirstStart
                    FROM (
                        SELECT DISTINCT b.UserId
                        FROM Bookings b
                        JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                        WHERE b.VenueId IN @VenueIds
                          AND b.IsDeleted = 0
                          AND cs.IsDeleted = 0
                          AND b.Status IN ('confirmed', 'completed')
                          AND cs.StartTime >= @StartUtc
                          AND cs.StartTime < @EndUtc
                        UNION
                        SELECT DISTINCT r.UserId
                        FROM PublicSocialRegistrations r
                        JOIN PublicSocials s ON s.Id = r.SocialId
                        WHERE r.VenueId IN @VenueIds
                          AND s.IsDeleted = 0
                          AND r.Status = 'confirmed'
                          AND s.StartTime >= @StartUtc
                          AND s.StartTime < @EndUtc
                    ) active_players
                    JOIN (
                        SELECT b2.UserId, cs2.StartTime
                        FROM Bookings b2
                        JOIN CourtSessions cs2 ON cs2.Id = b2.CourtSessionId
                        WHERE b2.VenueId IN @VenueIds
                          AND b2.IsDeleted = 0
                          AND cs2.IsDeleted = 0
                          AND b2.Status IN ('confirmed', 'completed')
                        UNION ALL
                        SELECT r2.UserId, s2.StartTime
                        FROM PublicSocialRegistrations r2
                        JOIN PublicSocials s2 ON s2.Id = r2.SocialId
                        WHERE r2.VenueId IN @VenueIds
                          AND s2.IsDeleted = 0
                          AND r2.Status = 'confirmed'
                    ) all_activity ON all_activity.UserId = active_players.UserId
                    GROUP BY active_players.UserId
                ) player_first
                """,
                new { VenueIds = venueIds, StartUtc = startUtc, EndUtc = endUtc },
                cancellationToken: cancellationToken));
        return (row.NewPlayers, row.ReturningPlayers);
    }

    private async Task<decimal> ComputeAvailableCourtHoursAsync(
        MySqlConnection connection,
        Guid[] venueIds,
        int activeCourtsCount,
        DateOnly startLocal,
        DateOnly effectiveEndLocalExclusive,
        DateTime startUtc,
        DateTime endUtc,
        CancellationToken cancellationToken)
    {
        if (activeCourtsCount <= 0)
        {
            return 0m;
        }

        var daysCount = Math.Max(1, effectiveEndLocalExclusive.DayNumber - startLocal.DayNumber);
        var grossHours = (decimal)(daysCount * BookableHoursPerDay * activeCourtsCount);

        var oneOffClosedHours = await connection.ExecuteScalarAsync<decimal>(
            new CommandDefinition(
                """
                SELECT COALESCE(SUM(
                    GREATEST(
                        0,
                        TIMESTAMPDIFF(
                            MINUTE,
                            GREATEST(cc.StartTime, @StartUtc),
                            LEAST(cc.EndTime, @EndUtc)
                        )
                    ) / 60.0 * CASE WHEN cc.CourtId IS NULL THEN @ActiveCourts ELSE 1 END
                ), 0)
                FROM CourtClosures cc
                WHERE cc.VenueId IN @VenueIds
                  AND cc.StartTime < @EndUtc
                  AND cc.EndTime > @StartUtc
                """,
                new
                {
                    VenueIds = venueIds,
                    StartUtc = startUtc,
                    EndUtc = endUtc,
                    ActiveCourts = Math.Max(1, activeCourtsCount),
                },
                cancellationToken: cancellationToken));

        var dailyClosedHours = 0m;
        try
        {
            var dailyClosures = await connection.QueryAsync<DailyClosureWindowRow>(
                new CommandDefinition(
                    """
                    SELECT dc.CourtId,
                           dc.FromDate,
                           dc.UntilDate,
                           TIME_TO_SEC(dc.StartTime) / 3600.0 AS StartHour,
                           CASE WHEN dc.EndTime = '00:00:00' THEN 24.0 ELSE TIME_TO_SEC(dc.EndTime) / 3600.0 END AS EndHour
                    FROM DailyClosures dc
                    WHERE dc.VenueId IN @VenueIds
                      AND dc.FromDate < @EndDate
                      AND (dc.UntilDate IS NULL OR dc.UntilDate >= @StartDate)
                    """,
                    new
                    {
                        VenueIds = venueIds,
                        StartDate = startLocal.ToDateTime(TimeOnly.MinValue),
                        EndDate = effectiveEndLocalExclusive.ToDateTime(TimeOnly.MinValue),
                    },
                    cancellationToken: cancellationToken));

            foreach (var dc in dailyClosures)
            {
                var dcFrom = DateOnly.FromDateTime(dc.FromDate);
                var dcUntilInclusive = dc.UntilDate is DateTime untilDt
                    ? DateOnly.FromDateTime(untilDt)
                    : effectiveEndLocalExclusive.AddDays(-1);
                var overlapStart = dcFrom > startLocal ? dcFrom : startLocal;
                var overlapEndInclusive = dcUntilInclusive < effectiveEndLocalExclusive.AddDays(-1)
                    ? dcUntilInclusive
                    : effectiveEndLocalExclusive.AddDays(-1);
                if (overlapEndInclusive < overlapStart)
                {
                    continue;
                }

                var overlapDays = overlapEndInclusive.DayNumber - overlapStart.DayNumber + 1;
                var clampedStart = Math.Max(6m, dc.StartHour);
                var clampedEnd = Math.Min(24m, dc.EndHour);
                if (clampedEnd <= clampedStart)
                {
                    continue;
                }

                var hoursPerDay = clampedEnd - clampedStart;
                var courtMultiplier = dc.CourtId is null ? Math.Max(1, activeCourtsCount) : 1;
                dailyClosedHours += overlapDays * hoursPerDay * courtMultiplier;
            }
        }
        catch (MySqlException)
        {
            // Ignore if DailyClosures table is not present in older schema versions.
        }

        var netAvailable = grossHours - oneOffClosedHours - dailyClosedHours;
        return Math.Max(0m, netAvailable);
    }

    private static StatsOverviewResult BuildOverviewResult(
        StatsVenueScope scope,
        StatsPeriodWindow window,
        PeriodSnapshot current,
        PeriodSnapshot previous,
        bool compare)
    {
        var hasCurrentData = current.TotalBookings > 0 || current.CancelledCount > 0;
        var hasPreviousData = compare && (previous.TotalBookings > 0 || previous.CancelledCount > 0);

        var curPlayers = current.NewPlayers + current.ReturningPlayers;
        var prevPlayers = previous.NewPlayers + previous.ReturningPlayers;
        var curReturnRate = curPlayers > 0
            ? decimal.Round(((decimal)current.ReturningPlayers / curPlayers) * 100m, 1)
            : 0m;
        var prevReturnRate = prevPlayers > 0
            ? decimal.Round(((decimal)previous.ReturningPlayers / prevPlayers) * 100m, 1)
            : 0m;

        return new StatsOverviewResult(
            Venues: scope.Venues,
            SelectedVenueId: scope.SelectedVenueId,
            SelectedVenueName: scope.SelectedVenueName,
            IsAllVenues: scope.IsAllVenues,
            TimeZone: scope.TimeZone,
            Currency: scope.Currency,
            ActiveCourts: scope.ActiveCourts,
            Period: window.Period,
            AnchorDate: window.AnchorDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            StartDate: window.StartLocal.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            EndDate: window.EndLocalInclusive.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            DateRangeLabel: window.DateRangeLabel,
            PreviousDateRangeLabel: window.PreviousDateRangeLabel,
            IsPartialPeriod: window.IsPartialPeriod,
            ElapsedDays: window.ElapsedDays,
            TotalDays: window.TotalDays,
            Compare: compare,
            HasCurrentData: hasCurrentData,
            HasPreviousData: hasPreviousData,
            TotalBookings: BuildMetricDelta(current.TotalBookings, previous.TotalBookings, hasPreviousData, higherIsBetter: true),
            CourtBookings: current.CourtBookings,
            SocialBookings: current.SocialBookings,
            TotalRevenue: BuildMetricDelta(current.TotalRevenue, previous.TotalRevenue, hasPreviousData, higherIsBetter: true),
            CourtRevenue: current.CourtRevenue,
            SocialRevenue: current.SocialRevenue,
            DiscountsGranted: current.DiscountsGranted,
            AvgRevenuePerBooking: BuildMetricDelta(current.AvgRevenuePerBooking, previous.AvgRevenuePerBooking, hasPreviousData, higherIsBetter: true),
            CourtUtilization: new UtilizationMetric(
                Current: current.UtilizationPercent,
                Previous: hasPreviousData ? previous.UtilizationPercent : null,
                DeltaPercent: ComputePointOrPercentDelta(current.UtilizationPercent, previous.UtilizationPercent, hasPreviousData),
                Trend: ResolveTrend(current.UtilizationPercent, previous.UtilizationPercent, hasPreviousData, higherIsBetter: true),
                BookedHours: current.BookedHours,
                AvailableHours: current.AvailableHours,
                PreviousBookedHours: hasPreviousData ? previous.BookedHours : null,
                PreviousAvailableHours: hasPreviousData ? previous.AvailableHours : null),
            CancellationRate: new RateMetric(
                Current: current.CancellationRatePercent,
                Previous: hasPreviousData ? previous.CancellationRatePercent : null,
                DeltaPercent: ComputePointOrPercentDelta(current.CancellationRatePercent, previous.CancellationRatePercent, hasPreviousData),
                Trend: ResolveTrend(current.CancellationRatePercent, previous.CancellationRatePercent, hasPreviousData, higherIsBetter: false),
                Count: current.CancelledCount,
                Denominator: current.CommittedAndCancelledCount),
            RescheduleRate: new RateMetric(
                Current: current.RescheduleRatePercent,
                Previous: hasPreviousData ? previous.RescheduleRatePercent : null,
                DeltaPercent: ComputePointOrPercentDelta(current.RescheduleRatePercent, previous.RescheduleRatePercent, hasPreviousData),
                Trend: ResolveTrend(current.RescheduleRatePercent, previous.RescheduleRatePercent, hasPreviousData, higherIsBetter: false),
                Count: current.RescheduledCount,
                Denominator: Math.Max(current.TotalBookings, current.RescheduledCount)),
            PlayerRetention: new RetentionOverviewMetric(
                NewPlayers: current.NewPlayers,
                ReturningPlayers: current.ReturningPlayers,
                TotalPlayers: curPlayers,
                ReturningRatePercent: curReturnRate,
                PreviousReturningRatePercent: hasPreviousData ? prevReturnRate : null,
                DeltaPercent: ComputePointOrPercentDelta(curReturnRate, prevReturnRate, hasPreviousData),
                Trend: ResolveTrend(curReturnRate, prevReturnRate, hasPreviousData, higherIsBetter: true)));
    }

    private static MetricDelta BuildMetricDelta(decimal current, decimal previous, bool hasPreviousData, bool higherIsBetter) =>
        new(
            Current: current,
            Previous: hasPreviousData ? previous : null,
            DeltaPercent: ComputePercentChange(current, previous, hasPreviousData),
            Trend: ResolveTrend(current, previous, hasPreviousData, higherIsBetter));

    private static decimal? ComputePercentChange(decimal current, decimal previous, bool hasPreviousData)
    {
        if (!hasPreviousData || previous == 0m)
        {
            return null;
        }

        return decimal.Round(((current - previous) / Math.Abs(previous)) * 100m, 1);
    }

    private static decimal? ComputePointOrPercentDelta(decimal current, decimal previous, bool hasPreviousData)
    {
        if (!hasPreviousData)
        {
            return null;
        }

        if (previous == 0m)
        {
            return current == 0m ? 0m : null;
        }

        return decimal.Round(((current - previous) / Math.Abs(previous)) * 100m, 1);
    }

    private static string ResolveTrend(decimal current, decimal previous, bool hasPreviousData, bool higherIsBetter)
    {
        if (!hasPreviousData || current == previous)
        {
            return "neutral";
        }

        var increased = current > previous;
        if (higherIsBetter)
        {
            return increased ? "up_good" : "down_bad";
        }

        return increased ? "up_bad" : "down_good";
    }

    private static PeriodSnapshot EmptySnapshot() =>
        new(0, 0, 0, 0m, 0m, 0m, 0m, 0m, 0m, 0m, 0m, 0, 0, 0m, 0, 0m, 0, 0);

    public static string FormatDateRangeLabel(DateOnly start, DateOnly endInclusive)
    {
        var culture = CultureInfo.InvariantCulture;
        if (start == endInclusive)
        {
            return start.ToString("d MMM yyyy", culture);
        }

        if (start.Year == endInclusive.Year && start.Month == endInclusive.Month)
        {
            return $"{start.Day} – {endInclusive.Day} {endInclusive.ToString("MMM yyyy", culture)}";
        }

        if (start.Year == endInclusive.Year)
        {
            return $"{start.ToString("d MMM", culture)} – {endInclusive.ToString("d MMM yyyy", culture)}";
        }

        return $"{start.ToString("d MMM yyyy", culture)} – {endInclusive.ToString("d MMM yyyy", culture)}";
    }

    private static TimeZoneInfo ResolveTimeZone(string? timeZoneId)
    {
        if (!string.IsNullOrWhiteSpace(timeZoneId))
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId.Trim());
            }
            catch (TimeZoneNotFoundException)
            {
                // Fall through to default
            }
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Australia/Melbourne");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
    }

    internal static DateTime ToUtcSafe(DateOnly localDate, TimeZoneInfo zone)
    {
        var localDateTime = DateTime.SpecifyKind(localDate.ToDateTime(TimeOnly.MinValue), DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(localDateTime))
        {
            localDateTime = localDateTime.AddHours(1);
        }

        return TimeZoneInfo.ConvertTimeToUtc(localDateTime, zone);
    }

    private Task<MySqlConnection> OpenAsync(CancellationToken cancellationToken) =>
        DbConnectionFactory.OpenAsync(configuration, cancellationToken);
}

