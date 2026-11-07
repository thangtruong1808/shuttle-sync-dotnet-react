using System.Globalization;
using Dapper;
using MySqlConnector;
using ShuttleSync.Api.Booking;

namespace ShuttleSync.Api.Data;

public sealed partial class DashboardStatsRepository
{
    private static readonly string[] DayFullNames =
    [
        "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"
    ];

    private static readonly string[] DayShortNames =
    [
        "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
    ];

    public async Task<StatsTrendsResult> GetTrendsAsync(
        StatsVenueScope scope,
        StatsPeriodWindow window,
        bool compare,
        CancellationToken cancellationToken)
    {
        if (scope.VenueIds.Length == 0)
        {
            var emptyBuckets = BuildTrendBuckets(window, [], [], includePrevious: false);
            return new StatsTrendsResult(
                Period: window.Period,
                DateRangeLabel: window.DateRangeLabel,
                PreviousDateRangeLabel: window.PreviousDateRangeLabel,
                Compare: compare,
                HasCurrentData: false,
                HasPreviousData: false,
                TotalBookings: 0,
                TotalRevenue: 0m,
                PreviousTotalBookings: null,
                PreviousTotalRevenue: null,
                Buckets: emptyBuckets);
        }

        await using var connection = await OpenAsync(cancellationToken);

        var currentDaily = await QueryDailyActivityAsync(
            connection,
            scope.VenueIds,
            window.StartUtc,
            window.EndUtc,
            window.TzOffsetMinutes,
            cancellationToken);

        var previousDaily = compare
            ? await QueryDailyActivityAsync(
                connection,
                scope.VenueIds,
                window.PrevStartUtc,
                window.PrevEndUtc,
                window.TzOffsetMinutes,
                cancellationToken)
            : new Dictionary<DateOnly, DailyPoint>();

        var hasCurrentData = currentDaily.Values.Any(p => p.TotalBookings > 0 || p.TotalRevenue > 0m);
        var hasPreviousData = compare && previousDaily.Values.Any(p => p.TotalBookings > 0 || p.TotalRevenue > 0m);

        var buckets = BuildTrendBuckets(window, currentDaily, previousDaily, hasPreviousData);

        var totalBookings = buckets.Sum(b => b.Bookings);
        var totalRevenue = decimal.Round(buckets.Sum(b => b.Revenue), 2);
        var prevTotalBookings = hasPreviousData ? buckets.Sum(b => b.PreviousBookings ?? 0) : (int?)null;
        var prevTotalRevenue = hasPreviousData ? decimal.Round(buckets.Sum(b => b.PreviousRevenue ?? 0m), 2) : (decimal?)null;

        return new StatsTrendsResult(
            Period: window.Period,
            DateRangeLabel: window.DateRangeLabel,
            PreviousDateRangeLabel: window.PreviousDateRangeLabel,
            Compare: compare,
            HasCurrentData: hasCurrentData,
            HasPreviousData: hasPreviousData,
            TotalBookings: totalBookings,
            TotalRevenue: totalRevenue,
            PreviousTotalBookings: prevTotalBookings,
            PreviousTotalRevenue: prevTotalRevenue,
            Buckets: buckets);
    }

    private async Task<Dictionary<DateOnly, DailyPoint>> QueryDailyActivityAsync(
        MySqlConnection connection,
        Guid[] venueIds,
        DateTime startUtc,
        DateTime endUtc,
        int tzOffsetMinutes,
        CancellationToken cancellationToken)
    {
        var rows = await connection.QueryAsync<DailyActivitySqlRow>(
            new CommandDefinition(
                """
                SELECT LocalDay,
                       CAST(COALESCE(SUM(CourtBookings), 0) AS SIGNED) AS CourtBookings,
                       CAST(COALESCE(SUM(SocialBookings), 0) AS SIGNED) AS SocialBookings,
                       COALESCE(SUM(CourtRevenue), 0) AS CourtRevenue,
                       COALESCE(SUM(SocialRevenue), 0) AS SocialRevenue,
                       COALESCE(SUM(BookedHours), 0) AS BookedHours
                FROM (
                    SELECT DATE(TIMESTAMPADD(MINUTE, @TzOffsetMinutes, cs.StartTime)) AS LocalDay,
                           1 AS CourtBookings,
                           0 AS SocialBookings,
                           b.TotalAmount AS CourtRevenue,
                           0 AS SocialRevenue,
                           GREATEST(0, TIMESTAMPDIFF(MINUTE, cs.StartTime, cs.EndTime)) / 60.0 AS BookedHours
                    FROM Bookings b
                    JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                    WHERE b.VenueId IN @VenueIds
                      AND b.IsDeleted = 0
                      AND cs.IsDeleted = 0
                      AND b.Status IN ('confirmed', 'completed')
                      AND cs.StartTime >= @StartUtc
                      AND cs.StartTime < @EndUtc

                    UNION ALL

                    SELECT DATE(TIMESTAMPADD(MINUTE, @TzOffsetMinutes, s.StartTime)) AS LocalDay,
                           0 AS CourtBookings,
                           1 AS SocialBookings,
                           0 AS CourtRevenue,
                           s.Price * (
                               1 + (
                                   SELECT COUNT(*)
                                   FROM PublicSocialFriends f
                                   WHERE f.RegistrationId = r.Id AND f.Status = 'confirmed'
                               )
                           ) AS SocialRevenue,
                           0 AS BookedHours
                    FROM PublicSocialRegistrations r
                    JOIN PublicSocials s ON s.Id = r.SocialId
                    WHERE r.VenueId IN @VenueIds
                      AND s.IsDeleted = 0
                      AND r.Status = 'confirmed'
                      AND s.StartTime >= @StartUtc
                      AND s.StartTime < @EndUtc
                ) combined
                GROUP BY LocalDay
                ORDER BY LocalDay
                """,
                new
                {
                    VenueIds = venueIds,
                    StartUtc = startUtc,
                    EndUtc = endUtc,
                    TzOffsetMinutes = tzOffsetMinutes,
                },
                cancellationToken: cancellationToken));

        var map = new Dictionary<DateOnly, DailyPoint>();
        foreach (var row in rows)
        {
            var d = DateOnly.FromDateTime(row.LocalDay);
            map[d] = new DailyPoint(
                CourtBookings: row.CourtBookings,
                SocialBookings: row.SocialBookings,
                TotalBookings: row.CourtBookings + row.SocialBookings,
                TotalRevenue: decimal.Round(row.CourtRevenue + row.SocialRevenue, 2),
                BookedHours: decimal.Round(row.BookedHours, 2));
        }

        return map;
    }

    private static TrendBucketDto[] BuildTrendBuckets(
        StatsPeriodWindow window,
        Dictionary<DateOnly, DailyPoint> currentDaily,
        Dictionary<DateOnly, DailyPoint> previousDaily,
        bool includePrevious)
    {
        var culture = CultureInfo.InvariantCulture;
        var buckets = new List<TrendBucketDto>();

        if (window.Period == "yearly" && window.TotalDays >= 300)
        {
            for (var m = 0; m < 12; m++)
            {
                var monthStart = window.StartLocal.AddMonths(m);
                var monthEndEx = monthStart.AddMonths(1);
                var prevMonthStart = window.PrevStartLocal.AddMonths(m);
                var prevMonthEndEx = prevMonthStart.AddMonths(1);

                var cur = SumRange(currentDaily, monthStart, monthEndEx);
                var prev = SumRange(previousDaily, prevMonthStart, prevMonthEndEx);

                buckets.Add(new TrendBucketDto(
                    Index: m,
                    Key: monthStart.ToString("yyyy-MM", culture),
                    Label: monthStart.ToString("MMM yyyy", culture),
                    ShortLabel: monthStart.ToString("MMM", culture),
                    Bookings: cur.TotalBookings,
                    CourtBookings: cur.CourtBookings,
                    SocialBookings: cur.SocialBookings,
                    Revenue: cur.TotalRevenue,
                    BookedHours: cur.BookedHours,
                    PreviousLabel: includePrevious ? prevMonthStart.ToString("MMM yyyy", culture) : null,
                    PreviousBookings: includePrevious ? prev.TotalBookings : null,
                    PreviousRevenue: includePrevious ? prev.TotalRevenue : null));
            }

            return buckets.ToArray();
        }

        if (window.Period == "quarterly" && window.TotalDays > 35)
        {
            var curCursor = window.StartLocal;
            var prevCursor = window.PrevStartLocal;
            var index = 0;
            while (curCursor < window.EndLocalExclusive)
            {
                var nextCur = curCursor.AddDays(7);
                if (nextCur > window.EndLocalExclusive)
                {
                    nextCur = window.EndLocalExclusive;
                }

                var span = nextCur.DayNumber - curCursor.DayNumber;
                var nextPrev = prevCursor.AddDays(span);
                if (nextPrev > window.PrevEndLocalExclusive)
                {
                    nextPrev = window.PrevEndLocalExclusive;
                }

                var cur = SumRange(currentDaily, curCursor, nextCur);
                var prev = SumRange(previousDaily, prevCursor, nextPrev);

                var endInc = nextCur.AddDays(-1);
                var prevEndInc = nextPrev.AddDays(-1);
                buckets.Add(new TrendBucketDto(
                    Index: index,
                    Key: $"W{index + 1}",
                    Label: $"{curCursor.ToString("d MMM", culture)} – {endInc.ToString("d MMM", culture)}",
                    ShortLabel: curCursor.ToString("d MMM", culture),
                    Bookings: cur.TotalBookings,
                    CourtBookings: cur.CourtBookings,
                    SocialBookings: cur.SocialBookings,
                    Revenue: cur.TotalRevenue,
                    BookedHours: cur.BookedHours,
                    PreviousLabel: includePrevious
                        ? $"{prevCursor.ToString("d MMM", culture)} – {prevEndInc.ToString("d MMM", culture)}"
                        : null,
                    PreviousBookings: includePrevious ? prev.TotalBookings : null,
                    PreviousRevenue: includePrevious ? prev.TotalRevenue : null));

                curCursor = nextCur;
                prevCursor = nextPrev;
                index++;
            }

            return buckets.ToArray();
        }

        // Daily buckets for weekly and monthly periods
        for (var i = 0; i < window.TotalDays; i++)
        {
            var day = window.StartLocal.AddDays(i);
            var prevDay = window.PrevStartLocal.AddDays(i);
            var hasPrevDay = prevDay < window.PrevEndLocalExclusive;

            currentDaily.TryGetValue(day, out var cur);
            cur ??= new DailyPoint(0, 0, 0, 0m, 0m);

            DailyPoint? prev = null;
            if (includePrevious && hasPrevDay)
            {
                previousDaily.TryGetValue(prevDay, out prev);
                prev ??= new DailyPoint(0, 0, 0, 0m, 0m);
            }

            var dowIndex = ((int)day.DayOfWeek + 6) % 7;
            var shortLabel = window.Period == "weekly"
                ? DayShortNames[dowIndex]
                : day.Day.ToString(culture);
            var fullLabel = window.Period == "weekly"
                ? $"{DayShortNames[dowIndex]} {day.ToString("d MMM", culture)}"
                : day.ToString("d MMM yyyy", culture);

            buckets.Add(new TrendBucketDto(
                Index: i,
                Key: day.ToString("yyyy-MM-dd", culture),
                Label: fullLabel,
                ShortLabel: shortLabel,
                Bookings: cur.TotalBookings,
                CourtBookings: cur.CourtBookings,
                SocialBookings: cur.SocialBookings,
                Revenue: cur.TotalRevenue,
                BookedHours: cur.BookedHours,
                PreviousLabel: prev is not null ? prevDay.ToString("d MMM yyyy", culture) : null,
                PreviousBookings: prev?.TotalBookings,
                PreviousRevenue: prev?.TotalRevenue));
        }

        return buckets.ToArray();
    }

    private static DailyPoint SumRange(Dictionary<DateOnly, DailyPoint> map, DateOnly start, DateOnly endExclusive)
    {
        var court = 0;
        var social = 0;
        var rev = 0m;
        var hours = 0m;
        for (var d = start; d < endExclusive; d = d.AddDays(1))
        {
            if (map.TryGetValue(d, out var pt))
            {
                court += pt.CourtBookings;
                social += pt.SocialBookings;
                rev += pt.TotalRevenue;
                hours += pt.BookedHours;
            }
        }

        return new DailyPoint(court, social, court + social, decimal.Round(rev, 2), decimal.Round(hours, 2));
    }

    public async Task<StatsDemandResult> GetDemandAsync(
        StatsVenueScope scope,
        StatsPeriodWindow window,
        CancellationToken cancellationToken)
    {
        if (scope.VenueIds.Length == 0)
        {
            return EmptyDemandResult();
        }

        await using var connection = await OpenAsync(cancellationToken);

        var slotRows = await connection.QueryAsync<SlotDemandSqlRow>(
            new CommandDefinition(
                """
                SELECT DayIndex,
                       HourOfDay,
                       CAST(COUNT(*) AS SIGNED) AS Bookings,
                       COALESCE(SUM(BookedHours), 0) AS BookedHours,
                       COALESCE(SUM(Revenue), 0) AS Revenue
                FROM (
                    SELECT CAST(WEEKDAY(TIMESTAMPADD(MINUTE, @TzOffsetMinutes, cs.StartTime)) AS SIGNED) AS DayIndex,
                           CAST(HOUR(TIMESTAMPADD(MINUTE, @TzOffsetMinutes, cs.StartTime)) AS SIGNED) AS HourOfDay,
                           GREATEST(0, TIMESTAMPDIFF(MINUTE, cs.StartTime, cs.EndTime)) / 60.0 AS BookedHours,
                           b.TotalAmount AS Revenue
                    FROM Bookings b
                    JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                    WHERE b.VenueId IN @VenueIds
                      AND b.IsDeleted = 0
                      AND cs.IsDeleted = 0
                      AND b.Status IN ('confirmed', 'completed')
                      AND cs.StartTime >= @StartUtc
                      AND cs.StartTime < @EndUtc
                ) raw_slots
                GROUP BY DayIndex, HourOfDay
                """,
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                    TzOffsetMinutes = window.TzOffsetMinutes,
                },
                cancellationToken: cancellationToken));

        var socialSlotRows = await connection.QueryAsync<SlotDemandSqlRow>(
            new CommandDefinition(
                """
                SELECT DayIndex,
                       HourOfDay,
                       CAST(COUNT(*) AS SIGNED) AS Bookings,
                       COALESCE(SUM(BookedHours), 0) AS BookedHours,
                       COALESCE(SUM(Revenue), 0) AS Revenue
                FROM (
                    SELECT CAST(WEEKDAY(TIMESTAMPADD(MINUTE, @TzOffsetMinutes, s.StartTime)) AS SIGNED) AS DayIndex,
                           CAST(HOUR(TIMESTAMPADD(MINUTE, @TzOffsetMinutes, s.StartTime)) AS SIGNED) AS HourOfDay,
                           GREATEST(0, TIMESTAMPDIFF(MINUTE, s.StartTime, s.EndTime)) / 60.0 AS BookedHours,
                           s.Price * (
                               1 + (
                                   SELECT COUNT(*)
                                   FROM PublicSocialFriends f
                                   WHERE f.RegistrationId = r.Id AND f.Status = 'confirmed'
                               )
                           ) AS Revenue
                    FROM PublicSocialRegistrations r
                    JOIN PublicSocials s ON s.Id = r.SocialId
                    WHERE r.VenueId IN @VenueIds
                      AND s.IsDeleted = 0
                      AND r.Status = 'confirmed'
                      AND s.StartTime >= @StartUtc
                      AND s.StartTime < @EndUtc
                ) raw_social_slots
                GROUP BY DayIndex, HourOfDay
                """,
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                    TzOffsetMinutes = window.TzOffsetMinutes,
                },
                cancellationToken: cancellationToken));

        var cellMap = new Dictionary<(int Day, int Hour), (int Bookings, decimal Hours, decimal Revenue)>();
        foreach (var row in slotRows.Concat(socialSlotRows))
        {
            if (row.DayIndex is < 0 or > 6)
            {
                continue;
            }

            var hour = Math.Clamp(row.HourOfDay, 6, 23);
            var key = (row.DayIndex, hour);
            cellMap.TryGetValue(key, out var existing);
            cellMap[key] = (
                existing.Bookings + row.Bookings,
                existing.Hours + row.BookedHours,
                existing.Revenue + row.Revenue);
        }

        var totalBookingsAllDays = cellMap.Values.Sum(v => v.Bookings);
        var maxDayBookings = Enumerable.Range(0, 7)
            .Select(d => Enumerable.Range(6, 18).Sum(h => cellMap.TryGetValue((d, h), out var v) ? v.Bookings : 0))
            .DefaultIfEmpty(0)
            .Max();

        var dayOfWeek = new DayDemandDto[7];
        for (var d = 0; d < 7; d++)
        {
            var bookings = 0;
            var hours = 0m;
            var revenue = 0m;
            for (var h = 6; h <= 23; h++)
            {
                if (cellMap.TryGetValue((d, h), out var cell))
                {
                    bookings += cell.Bookings;
                    hours += cell.Hours;
                    revenue += cell.Revenue;
                }
            }

            var share = totalBookingsAllDays > 0
                ? decimal.Round(((decimal)bookings / totalBookingsAllDays) * 100m, 1)
                : 0m;

            dayOfWeek[d] = new DayDemandDto(
                DayIndex: d,
                ShortName: DayShortNames[d],
                FullName: DayFullNames[d],
                Bookings: bookings,
                BookedHours: decimal.Round(hours, 2),
                Revenue: decimal.Round(revenue, 2),
                SharePercent: share,
                IsPeak: maxDayBookings > 0 && bookings == maxDayBookings);
        }

        var busiestDay = maxDayBookings > 0
            ? dayOfWeek.OrderByDescending(d => d.Bookings).ThenByDescending(d => d.Revenue).First()
            : null;

        var maxCellBookings = cellMap.Values.Select(v => v.Bookings).DefaultIfEmpty(0).Max();
        var heatmap = new List<HeatmapCellDto>(7 * 18);
        for (var d = 0; d < 7; d++)
        {
            for (var h = 6; h <= 23; h++)
            {
                cellMap.TryGetValue((d, h), out var cell);
                var intensity = maxCellBookings > 0
                    ? decimal.Round((decimal)cell.Bookings / maxCellBookings, 3)
                    : 0m;

                heatmap.Add(new HeatmapCellDto(
                    DayIndex: d,
                    DayShort: DayShortNames[d],
                    DayFull: DayFullNames[d],
                    Hour: h,
                    TimeLabel: $"{h:00}:00 – {(h + 1):00}:00",
                    Bookings: cell.Bookings,
                    BookedHours: decimal.Round(cell.Hours, 2),
                    Revenue: decimal.Round(cell.Revenue, 2),
                    Intensity: intensity));
            }
        }

        var peakSlots = heatmap
            .Where(c => c.Bookings > 0)
            .OrderByDescending(c => c.Bookings)
            .ThenByDescending(c => c.Revenue)
            .Take(3)
            .Select(c => new SlotHighlightDto(
                DayIndex: c.DayIndex,
                DayName: c.DayFull,
                ShortDay: c.DayShort,
                Hour: c.Hour,
                TimeLabel: c.TimeLabel,
                Bookings: c.Bookings,
                BookedHours: c.BookedHours,
                Revenue: c.Revenue,
                Suggestion: "High-demand peak window — ideal for standard or peak rate protection."))
            .ToArray();

        // Quietest slots: prioritize daytime/early-evening windows (09:00-21:00) with lowest bookings
        // so owners get actionable promotion candidates instead of just 06:00 AM every day.
        var quietCandidates = heatmap
            .Where(c => c.Hour is >= 9 and <= 20)
            .OrderBy(c => c.Bookings)
            .ThenBy(c => c.BookedHours)
            .ThenBy(c => c.DayIndex)
            .ThenBy(c => c.Hour)
            .GroupBy(c => c.DayIndex)
            .Select(g => g.First())
            .Take(3)
            .Select(c => new SlotHighlightDto(
                DayIndex: c.DayIndex,
                DayName: c.DayFull,
                ShortDay: c.DayShort,
                Hour: c.Hour,
                TimeLabel: c.TimeLabel,
                Bookings: c.Bookings,
                BookedHours: c.BookedHours,
                Revenue: c.Revenue,
                Suggestion: c.Bookings == 0
                    ? "Zero bookings in this period — consider an off-peak discount or bonus reward points."
                    : "Low occupancy window — candidate for happy-hour rate or drop-in social session."))
            .ToArray();

        // Per-court utilization
        var courts = await connection.QueryAsync<CourtDemandSqlRow>(
            new CommandDefinition(
                """
                SELECT c.Id AS CourtId,
                       c.VenueId,
                       v.Name AS VenueName,
                       c.CourtName,
                       c.CourtNumber,
                       c.SurfaceType,
                       c.IsActive,
                       CAST(COUNT(b.Id) AS SIGNED) AS Bookings,
                       COALESCE(SUM(CASE WHEN b.Id IS NOT NULL THEN GREATEST(0, TIMESTAMPDIFF(MINUTE, cs.StartTime, cs.EndTime)) / 60.0 ELSE 0 END), 0) AS BookedHours,
                       COALESCE(SUM(CASE WHEN b.Id IS NOT NULL THEN b.TotalAmount ELSE 0 END), 0) AS Revenue
                FROM Courts c
                JOIN Venues v ON v.Id = c.VenueId
                LEFT JOIN CourtSessions cs
                       ON cs.CourtId = c.Id
                      AND cs.VenueId = c.VenueId
                      AND cs.IsDeleted = 0
                      AND cs.StartTime >= @StartUtc
                      AND cs.StartTime < @EndUtc
                LEFT JOIN Bookings b
                       ON b.CourtSessionId = cs.Id
                      AND b.IsDeleted = 0
                      AND b.Status IN ('confirmed', 'completed')
                WHERE c.VenueId IN @VenueIds
                  AND c.IsDeleted = 0
                GROUP BY c.Id, c.VenueId, v.Name, c.CourtName, c.CourtNumber, c.SurfaceType, c.IsActive
                ORDER BY v.Name, c.CourtNumber
                """,
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                },
                cancellationToken: cancellationToken));

        var effectiveDays = window.IsPartialPeriod ? Math.Max(1, window.ElapsedDays) : window.TotalDays;
        var singleCourtAvailableHours = (decimal)(effectiveDays * BookableHoursPerDay);

        var courtUtilization = courts.Select(c =>
        {
            var avail = c.IsActive ? singleCourtAvailableHours : 0m;
            var hrs = decimal.Round(c.BookedHours, 2);
            var util = avail > 0m
                ? Math.Clamp(decimal.Round((hrs / avail) * 100m, 1), 0m, 100m)
                : 0m;
            var displayName = scope.IsAllVenues
                ? $"{c.VenueName} · {c.CourtName}"
                : c.CourtName;
            return new CourtUtilizationDto(
                CourtId: c.CourtId,
                VenueId: c.VenueId,
                VenueName: c.VenueName,
                CourtName: displayName,
                CourtNumber: c.CourtNumber,
                SurfaceType: c.SurfaceType ?? "Standard",
                IsActive: c.IsActive,
                Bookings: c.Bookings,
                BookedHours: hrs,
                AvailableHours: avail,
                UtilizationPercent: util,
                Revenue: decimal.Round(c.Revenue, 2));
        }).ToArray();

        return new StatsDemandResult(
            HasData: totalBookingsAllDays > 0,
            TotalBookings: totalBookingsAllDays,
            BusiestDay: busiestDay,
            DayOfWeek: dayOfWeek,
            Heatmap: heatmap.ToArray(),
            PeakSlots: peakSlots,
            QuietSlots: quietCandidates,
            CourtUtilization: courtUtilization);
    }

    public async Task<StatsPlayersResult> GetPlayersAsync(
        StatsVenueScope scope,
        StatsPeriodWindow window,
        CancellationToken cancellationToken)
    {
        if (scope.VenueIds.Length == 0)
        {
            return EmptyPlayersResult();
        }

        await using var connection = await OpenAsync(cancellationToken);

        var retentionCounts = await QueryPlayerRetentionCountsAsync(
            connection,
            scope.VenueIds,
            window.StartUtc,
            window.EndUtc,
            cancellationToken);

        var topRows = await connection.QueryAsync<TopPlayerSqlRow>(
            new CommandDefinition(
                """
                SELECT u.Id AS UserId,
                       u.DisplayName,
                       u.FirstName,
                       u.LastName,
                       u.Email,
                       CAST(COALESCE(SUM(period_act.CourtBookings), 0) AS SIGNED) AS CourtBookings,
                       CAST(COALESCE(SUM(period_act.SocialBookings), 0) AS SIGNED) AS SocialBookings,
                       CAST(COALESCE(SUM(period_act.CourtBookings + period_act.SocialBookings), 0) AS SIGNED) AS TotalBookings,
                       COALESCE(SUM(period_act.BookedHours), 0) AS BookedHours,
                       COALESCE(SUM(period_act.Spend), 0) AS TotalSpend,
                       MAX(period_act.LastBookingUtc) AS LastBookingUtc,
                       (
                           SELECT MIN(prior_act.StartTime)
                           FROM (
                               SELECT cs2.StartTime
                               FROM Bookings b2
                               JOIN CourtSessions cs2 ON cs2.Id = b2.CourtSessionId
                               WHERE b2.UserId = u.Id
                                 AND b2.VenueId IN @VenueIds
                                 AND b2.IsDeleted = 0
                                 AND cs2.IsDeleted = 0
                                 AND b2.Status IN ('confirmed', 'completed')
                               UNION ALL
                               SELECT s2.StartTime
                               FROM PublicSocialRegistrations r2
                               JOIN PublicSocials s2 ON s2.Id = r2.SocialId
                               WHERE r2.UserId = u.Id
                                 AND r2.VenueId IN @VenueIds
                                 AND s2.IsDeleted = 0
                                 AND r2.Status = 'confirmed'
                           ) prior_act
                       ) AS FirstBookingEverUtc
                FROM (
                    SELECT b.UserId,
                           COUNT(*) AS CourtBookings,
                           0 AS SocialBookings,
                           COALESCE(SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, cs.StartTime, cs.EndTime)) / 60.0), 0) AS BookedHours,
                           COALESCE(SUM(b.TotalAmount), 0) AS Spend,
                           MAX(cs.StartTime) AS LastBookingUtc
                    FROM Bookings b
                    JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                    WHERE b.VenueId IN @VenueIds
                      AND b.IsDeleted = 0
                      AND cs.IsDeleted = 0
                      AND b.Status IN ('confirmed', 'completed')
                      AND cs.StartTime >= @StartUtc
                      AND cs.StartTime < @EndUtc
                    GROUP BY b.UserId

                    UNION ALL

                    SELECT r.UserId,
                           0 AS CourtBookings,
                           COUNT(*) AS SocialBookings,
                           0 AS BookedHours,
                           COALESCE(SUM(s.Price * (
                               1 + (
                                   SELECT COUNT(*)
                                   FROM PublicSocialFriends f
                                   WHERE f.RegistrationId = r.Id AND f.Status = 'confirmed'
                               )
                           )), 0) AS Spend,
                           MAX(s.StartTime) AS LastBookingUtc
                    FROM PublicSocialRegistrations r
                    JOIN PublicSocials s ON s.Id = r.SocialId
                    WHERE r.VenueId IN @VenueIds
                      AND s.IsDeleted = 0
                      AND r.Status = 'confirmed'
                      AND s.StartTime >= @StartUtc
                      AND s.StartTime < @EndUtc
                    GROUP BY r.UserId
                ) period_act
                JOIN Users u ON u.Id = period_act.UserId
                GROUP BY u.Id, u.DisplayName, u.FirstName, u.LastName, u.Email
                ORDER BY TotalBookings DESC, TotalSpend DESC, LastBookingUtc DESC
                LIMIT 10
                """,
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                },
                cancellationToken: cancellationToken));

        var topPlayers = topRows.Select((row, idx) =>
        {
            var fullName = BuildPlayerName(row.DisplayName, row.FirstName, row.LastName, row.Email);
            var isReturning = row.FirstBookingEverUtc is DateTime firstUtc && firstUtc < window.StartUtc;
            return new TopPlayerDto(
                Rank: idx + 1,
                UserId: row.UserId,
                DisplayName: fullName,
                Email: row.Email,
                Initials: BuildInitials(fullName, row.Email),
                BookingsCount: row.TotalBookings,
                CourtBookingsCount: row.CourtBookings,
                SocialBookingsCount: row.SocialBookings,
                BookedHours: decimal.Round(row.BookedHours, 2),
                TotalSpend: decimal.Round(row.TotalSpend, 2),
                LastBookingAt: VenueClock.AsUtc(row.LastBookingUtc).ToString("O"),
                IsReturning: isReturning);
        }).ToArray();

        // Channel breakdown
        var channelRow = await connection.QuerySingleAsync<ChannelAggSqlRow>(
            new CommandDefinition(
                """
                SELECT
                    CAST(COALESCE(SUM(CASE WHEN b.GroupId IS NOT NULL OR b.RepeatHold = 1 OR COALESCE(b.SeriesWeeks, 1) > 1 THEN 1 ELSE 0 END), 0) AS SIGNED) AS SeriesBookings,
                    COALESCE(SUM(CASE WHEN b.GroupId IS NOT NULL OR b.RepeatHold = 1 OR COALESCE(b.SeriesWeeks, 1) > 1 THEN b.TotalAmount ELSE 0 END), 0) AS SeriesRevenue,
                    CAST(COALESCE(SUM(CASE WHEN (b.GroupId IS NULL AND b.RepeatHold = 0 AND COALESCE(b.SeriesWeeks, 1) <= 1) AND (b.DiscountAmount > 0 OR b.PointsRedeemed > 0) THEN 1 ELSE 0 END), 0) AS SIGNED) AS PromoRewardBookings,
                    COALESCE(SUM(CASE WHEN (b.GroupId IS NULL AND b.RepeatHold = 0 AND COALESCE(b.SeriesWeeks, 1) <= 1) AND (b.DiscountAmount > 0 OR b.PointsRedeemed > 0) THEN b.TotalAmount ELSE 0 END), 0) AS PromoRewardRevenue,
                    CAST(COALESCE(SUM(CASE WHEN (b.GroupId IS NULL AND b.RepeatHold = 0 AND COALESCE(b.SeriesWeeks, 1) <= 1) AND b.DiscountAmount = 0 AND b.PointsRedeemed = 0 THEN 1 ELSE 0 END), 0) AS SIGNED) AS StandardBookings,
                    COALESCE(SUM(CASE WHEN (b.GroupId IS NULL AND b.RepeatHold = 0 AND COALESCE(b.SeriesWeeks, 1) <= 1) AND b.DiscountAmount = 0 AND b.PointsRedeemed = 0 THEN b.TotalAmount ELSE 0 END), 0) AS StandardRevenue,
                    CAST(COALESCE(SUM(CASE WHEN b.RepeatHold = 1 THEN 1 ELSE 0 END), 0) AS SIGNED) AS RepeatHoldBookings
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                WHERE b.VenueId IN @VenueIds
                  AND b.IsDeleted = 0
                  AND cs.IsDeleted = 0
                  AND b.Status IN ('confirmed', 'completed')
                  AND cs.StartTime >= @StartUtc
                  AND cs.StartTime < @EndUtc
                """,
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                },
                cancellationToken: cancellationToken));

        var socialChannelRow = await connection.QuerySingleAsync<SocialAggRow>(
            new CommandDefinition(
                """
                SELECT
                    CAST(COALESCE(SUM(CASE WHEN r.Status = 'confirmed' THEN 1 ELSE 0 END), 0) AS SIGNED) AS ConfirmedSocials,
                    CAST(0 AS SIGNED) AS CancelledSocials,
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
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                },
                cancellationToken: cancellationToken));

        var totalChannelBookings = channelRow.StandardBookings
            + channelRow.SeriesBookings
            + channelRow.PromoRewardBookings
            + socialChannelRow.ConfirmedSocials;

        var rawChannels = new (string Channel, string Label, int Count, decimal Revenue)[]
        {
            ("standard_court", "Standard Court Booking", channelRow.StandardBookings, decimal.Round(channelRow.StandardRevenue, 2)),
            ("repeat_series", "Weekly Series / Repeat Hold", channelRow.SeriesBookings, decimal.Round(channelRow.SeriesRevenue, 2)),
            ("promo_reward", "Promo / Reward Redeemed", channelRow.PromoRewardBookings, decimal.Round(channelRow.PromoRewardRevenue, 2)),
            ("drop_in_social", "Drop-In Social Session", socialChannelRow.ConfirmedSocials, decimal.Round(socialChannelRow.SocialRevenue, 2)),
        };

        var channelBreakdown = rawChannels.Select(ch => new ChannelBreakdownDto(
            Channel: ch.Channel,
            Label: ch.Label,
            BookingsCount: ch.Count,
            Revenue: ch.Revenue,
            SharePercent: totalChannelBookings > 0
                ? decimal.Round(((decimal)ch.Count / totalChannelBookings) * 100m, 1)
                : 0m)).ToArray();

        // Payment breakdown
        var paymentRows = await connection.QueryAsync<PaymentStatusSqlRow>(
            new CommandDefinition(
                """
                SELECT Status,
                       CAST(COUNT(*) AS SIGNED) AS PaymentCount,
                       COALESCE(SUM(GrossAmount), 0) AS GrossAmount,
                       COALESCE(SUM(RefundedAmount), 0) AS RefundedAmount
                FROM (
                    SELECT p.Status,
                           p.Amount AS GrossAmount,
                           COALESCE((
                               SELECT SUM(rf.Amount)
                               FROM Refunds rf
                               WHERE rf.PaymentId = p.Id AND rf.Status = 'succeeded'
                           ), 0) AS RefundedAmount
                    FROM Payments p
                    JOIN Bookings b ON b.Id = p.BookingId
                    JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                    WHERE b.VenueId IN @VenueIds
                      AND b.IsDeleted = 0
                      AND cs.StartTime >= @StartUtc
                      AND cs.StartTime < @EndUtc

                    UNION ALL

                    SELECT sp.Status,
                           sp.Amount AS GrossAmount,
                           COALESCE((
                               SELECT SUM(srf.Amount)
                               FROM PublicSocialRefunds srf
                               WHERE srf.PaymentId = sp.Id AND srf.Status = 'succeeded'
                           ), 0) AS RefundedAmount
                    FROM PublicSocialPayments sp
                    JOIN PublicSocialRegistrations r ON r.Id = sp.RegistrationId
                    JOIN PublicSocials s ON s.Id = r.SocialId
                    WHERE r.VenueId IN @VenueIds
                      AND s.IsDeleted = 0
                      AND s.StartTime >= @StartUtc
                      AND s.StartTime < @EndUtc
                ) all_payments
                GROUP BY Status
                ORDER BY GrossAmount DESC
                """,
                new
                {
                    VenueIds = scope.VenueIds,
                    StartUtc = window.StartUtc,
                    EndUtc = window.EndUtc,
                },
                cancellationToken: cancellationToken));

        var totalPaymentGross = paymentRows.Sum(p => p.GrossAmount);
        var paymentBreakdown = paymentRows.Select(p =>
        {
            var net = Math.Max(0m, p.GrossAmount - p.RefundedAmount);
            return new PaymentStatusBreakdownDto(
                Status: p.Status,
                Label: FormatPaymentStatusLabel(p.Status),
                Count: p.PaymentCount,
                GrossAmount: decimal.Round(p.GrossAmount, 2),
                RefundedAmount: decimal.Round(p.RefundedAmount, 2),
                NetAmount: decimal.Round(net, 2),
                SharePercent: totalPaymentGross > 0m
                    ? decimal.Round((p.GrossAmount / totalPaymentGross) * 100m, 1)
                    : 0m);
        }).ToArray();

        var totalPlayers = retentionCounts.NewPlayers + retentionCounts.ReturningPlayers;
        var newShare = totalPlayers > 0
            ? decimal.Round(((decimal)retentionCounts.NewPlayers / totalPlayers) * 100m, 1)
            : 0m;
        var returningShare = totalPlayers > 0
            ? decimal.Round(100m - newShare, 1)
            : 0m;

        return new StatsPlayersResult(
            HasData: totalPlayers > 0 || totalChannelBookings > 0,
            Retention: new PlayerRetentionDetailDto(
                NewPlayers: retentionCounts.NewPlayers,
                ReturningPlayers: retentionCounts.ReturningPlayers,
                TotalUniquePlayers: totalPlayers,
                NewSharePercent: newShare,
                ReturningSharePercent: returningShare,
                RepeatHoldBookings: channelRow.RepeatHoldBookings,
                SeriesBookings: channelRow.SeriesBookings),
            TopPlayers: topPlayers,
            PaymentBreakdown: paymentBreakdown,
            ChannelBreakdown: channelBreakdown);
    }

    private static string BuildPlayerName(string? displayName, string? firstName, string? lastName, string email)
    {
        if (!string.IsNullOrWhiteSpace(displayName))
        {
            return displayName.Trim();
        }

        var combined = $"{firstName?.Trim()} {lastName?.Trim()}".Trim();
        if (!string.IsNullOrWhiteSpace(combined))
        {
            return combined;
        }

        var atIndex = email.IndexOf('@');
        return atIndex > 0 ? email[..atIndex] : email;
    }

    private static string BuildInitials(string name, string email)
    {
        var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2)
        {
            return $"{char.ToUpperInvariant(parts[0][0])}{char.ToUpperInvariant(parts[^1][0])}";
        }

        if (parts.Length == 1 && parts[0].Length >= 2)
        {
            return parts[0][..2].ToUpperInvariant();
        }

        return email.Length >= 2 ? email[..2].ToUpperInvariant() : "PL";
    }

    private static string FormatPaymentStatusLabel(string status) =>
        status switch
        {
            "succeeded" => "Succeeded",
            "partially_refunded" => "Partially Refunded",
            "refunded" => "Refunded",
            "pending" => "Pending",
            "failed" => "Failed",
            "cancelled" => "Cancelled",
            _ => status,
        };

    private static StatsDemandResult EmptyDemandResult()
    {
        var days = Enumerable.Range(0, 7).Select(d => new DayDemandDto(
            DayIndex: d,
            ShortName: DayShortNames[d],
            FullName: DayFullNames[d],
            Bookings: 0,
            BookedHours: 0m,
            Revenue: 0m,
            SharePercent: 0m,
            IsPeak: false)).ToArray();

        var heatmap = new List<HeatmapCellDto>(7 * 18);
        for (var d = 0; d < 7; d++)
        {
            for (var h = 6; h <= 23; h++)
            {
                heatmap.Add(new HeatmapCellDto(
                    DayIndex: d,
                    DayShort: DayShortNames[d],
                    DayFull: DayFullNames[d],
                    Hour: h,
                    TimeLabel: $"{h:00}:00 – {(h + 1):00}:00",
                    Bookings: 0,
                    BookedHours: 0m,
                    Revenue: 0m,
                    Intensity: 0m));
            }
        }

        return new StatsDemandResult(
            HasData: false,
            TotalBookings: 0,
            BusiestDay: null,
            DayOfWeek: days,
            Heatmap: heatmap.ToArray(),
            PeakSlots: [],
            QuietSlots: [],
            CourtUtilization: []);
    }

    private static StatsPlayersResult EmptyPlayersResult() =>
        new(
            HasData: false,
            Retention: new PlayerRetentionDetailDto(0, 0, 0, 0m, 0m, 0, 0),
            TopPlayers: [],
            PaymentBreakdown: [],
            ChannelBreakdown: []);
}

