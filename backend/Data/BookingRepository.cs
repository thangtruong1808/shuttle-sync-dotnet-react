using Dapper;
using MySqlConnector;
using ShuttleSync.Api.Booking;

namespace ShuttleSync.Api.Data;

public sealed class BookingRepository(IConfiguration configuration)
{
    public async Task<VenueRow[]> ListActiveVenuesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<VenueRow>(
            new CommandDefinition(
                $"""
                SELECT {VenueColumns}
                FROM Venues
                WHERE IsActive = 1 AND IsDeleted = 0
                ORDER BY Name
                """,
                cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<VenueRow?> FindActiveVenueBySlugAsync(string slug, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<VenueRow>(
            new CommandDefinition(
                $"""
                SELECT {VenueColumns}
                FROM Venues
                WHERE Slug = @Slug AND IsActive = 1 AND IsDeleted = 0
                """,
                new { Slug = slug },
                cancellationToken: cancellationToken));
    }

    public async Task<PublicCourtRow[]> ListPublicCourtsAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PublicCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber, SurfaceType, ImageUrl, Description
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            """,
            new { VenueId = venueId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<ConfirmedBookingRow[]> ListConfirmedBookingsAsync(
        Guid venueId,
        DateTime dayStartUtc,
        DateTime dayEndUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<ConfirmedBookingRow>(new CommandDefinition(
            """
            SELECT b.Id AS BookingId, c.Id AS CourtId, b.Status, cs.StartTime, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId AND cs.IsDeleted = 0
            JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
            WHERE b.VenueId = @VenueId
              AND b.IsDeleted = 0
              AND cs.StartTime < @DayEndUtc
              AND cs.EndTime > @DayStartUtc
              AND (
                    (
                        b.Status = 'confirmed'
                        AND (
                            EXISTS (
                                SELECT 1 FROM Payments p
                                WHERE p.BookingId = b.Id AND p.Status IN ('succeeded', 'partially_refunded')
                            )
                            OR NOT EXISTS (
                                SELECT 1 FROM Payments p
                                WHERE p.BookingId = b.Id
                            )
                            OR EXISTS (
                                SELECT 1
                                FROM Payments p
                                JOIN Bookings payer ON payer.Id = p.BookingId
                                WHERE b.PayGroupId IS NOT NULL
                                  AND payer.PayGroupId = b.PayGroupId
                                  AND p.Status IN ('succeeded', 'partially_refunded')
                            )
                        )
                    )
                    OR (
                        b.Status = 'pending'
                        AND b.HoldExpiresAt IS NOT NULL
                        AND b.HoldExpiresAt > UTC_TIMESTAMP(6)
                    )
                  )
            ORDER BY c.CourtNumber, cs.StartTime
            """,
            new { VenueId = venueId, DayStartUtc = dayStartUtc, DayEndUtc = dayEndUtc },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<PublicClosureRow[]> ListPublicClosuresAsync(
        Guid venueId,
        DateTime dayStartUtc,
        DateTime dayEndUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PublicClosureRow>(new CommandDefinition(
            """
            SELECT Id, CourtId, StartTime, EndTime
            FROM CourtClosures
            WHERE VenueId = @VenueId
              AND StartTime < @DayEndUtc
              AND EndTime > @DayStartUtc
            ORDER BY StartTime
            """,
            new { VenueId = venueId, DayStartUtc = dayStartUtc, DayEndUtc = dayEndUtc },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<SupportSessionRow[]> ListSupportSessionsAsync(
        Guid venueId,
        DateTime rangeStartUtc,
        DateTime rangeEndUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<SupportSessionRow>(new CommandDefinition(
            """
            SELECT c.Id AS CourtId, c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime, cs.Price,
                   CASE WHEN EXISTS (
                       SELECT 1
                       FROM Bookings b
                       WHERE b.CourtSessionId = cs.Id
                         AND b.IsDeleted = 0
                         AND b.Status NOT IN ('cancelled', 'expired')
                         AND NOT (
                             b.Status = 'pending'
                             AND b.HoldExpiresAt IS NOT NULL
                             AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
                         )
                   ) THEN 1 ELSE 0 END AS Taken
            FROM CourtSessions cs
            JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
            WHERE cs.VenueId = @VenueId
              AND cs.IsDeleted = 0
              AND cs.StartTime < @RangeEndUtc
              AND cs.EndTime > @RangeStartUtc
            ORDER BY c.CourtNumber, cs.StartTime
            """,
            new { VenueId = venueId, RangeStartUtc = rangeStartUtc, RangeEndUtc = rangeEndUtc },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<AvailabilityRow[]> ListAvailableSlotsAsync(
        Guid venueId,
        DateTime dayStartUtc,
        DateTime dayEndUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<AvailabilityRow>(
            new CommandDefinition(
                """
                SELECT c.Id AS CourtId, c.CourtName, c.CourtNumber, c.SurfaceType, c.ImageUrl, c.Description,
                       cs.Id AS SessionId, cs.StartTime, cs.EndTime, cs.Price,
                       si.Points AS IncentivePoints
                FROM CourtSessions cs
                JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId
                LEFT JOIN SessionIncentives si ON si.CourtSessionId = cs.Id AND si.IsActive = 1
                WHERE cs.VenueId = @VenueId
                  AND cs.IsDeleted = 0
                  AND cs.StartTime > UTC_TIMESTAMP(6)
                  AND cs.StartTime >= @DayStartUtc
                  AND cs.StartTime < @DayEndUtc
                  AND c.IsActive = 1
                  AND c.IsDeleted = 0
                  AND NOT EXISTS (
                      SELECT 1
                      FROM Bookings b
                      WHERE b.CourtSessionId = cs.Id
                        AND b.IsDeleted = 0
                        AND b.Status NOT IN ('cancelled', 'expired')
                        AND NOT (
                            b.Status = 'pending'
                            AND b.HoldExpiresAt IS NOT NULL
                            AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
                        )
                  )
                  AND NOT EXISTS (
                      SELECT 1
                      FROM CourtClosures cc
                      WHERE cc.VenueId = cs.VenueId
                        AND (cc.CourtId = cs.CourtId OR cc.CourtId IS NULL)
                        AND cc.StartTime < cs.EndTime
                        AND cc.EndTime > cs.StartTime
                  )
                ORDER BY c.CourtNumber, cs.StartTime
                """,
                new { VenueId = venueId, DayStartUtc = dayStartUtc, DayEndUtc = dayEndUtc },
                cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<(Guid SessionId, decimal Price, string? Error)> OpenPlayerSessionAsync(
        Guid venueId,
        Guid courtId,
        decimal hourlyRate,
        DateTime startUtc,
        DateTime endUtc,
        CancellationToken cancellationToken)
    {
        if (endUtc <= startUtc)
        {
            return (Guid.Empty, 0, "The end time must be later than the start time.");
        }

        if (startUtc <= DateTime.UtcNow)
        {
            return (Guid.Empty, 0, "Choose a time that has not started.");
        }

        if (endUtc - startUtc < TimeSpan.FromMinutes(30))
        {
            return (Guid.Empty, 0, "Choose at least 30 minutes.");
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var court = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM Courts
            WHERE Id = @CourtId AND VenueId = @VenueId AND IsDeleted = 0 AND IsActive = 1
            FOR UPDATE
            """,
            new { CourtId = courtId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (court == 0)
        {
            return (Guid.Empty, 0, "This court is not available.");
        }

        var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*)
            FROM CourtClosures
            WHERE VenueId = @VenueId
              AND (CourtId = @CourtId OR CourtId IS NULL)
              AND StartTime < @EndTime AND EndTime > @StartTime
            """,
            new { VenueId = venueId, CourtId = courtId, StartTime = startUtc, EndTime = endUtc },
            tx,
            cancellationToken: cancellationToken));
        if (closed > 0)
        {
            return (Guid.Empty, 0, "This slot is not available.");
        }

        var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime
            FROM CourtSessions
            WHERE CourtId = @CourtId AND IsDeleted = 0
              AND StartTime < @EndTime AND EndTime > @StartTime
            FOR UPDATE
            """,
            new { CourtId = courtId, StartTime = startUtc, EndTime = endUtc },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (overlaps.Length == 1 && SameInstant(overlaps[0].StartTime, startUtc) && SameInstant(overlaps[0].EndTime, endUtc))
        {
            var taken = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*)
                FROM Bookings
                WHERE CourtSessionId = @Id AND IsDeleted = 0
                  AND Status NOT IN ('cancelled', 'expired')
                  AND NOT (
                      Status = 'pending'
                      AND HoldExpiresAt IS NOT NULL
                      AND HoldExpiresAt <= UTC_TIMESTAMP(6)
                  )
                """,
                new { Id = overlaps[0].Id },
                tx,
                cancellationToken: cancellationToken));
            if (taken > 0)
            {
                return (Guid.Empty, 0, "This slot is not available.");
            }

            var existingPrice = await connection.ExecuteScalarAsync<decimal>(new CommandDefinition(
                "SELECT Price FROM CourtSessions WHERE Id = @Id",
                new { Id = overlaps[0].Id },
                tx,
                cancellationToken: cancellationToken));
            await tx.CommitAsync(cancellationToken);
            return (overlaps[0].Id, existingPrice, null);
        }

        if (overlaps.Length > 0 && await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken) is not null)
        {
            return (Guid.Empty, 0, "This slot is not available.");
        }

        var windows = await LoadRateWindowsAsync(connection, venueId, tx, cancellationToken);
        if (hourlyRate <= 0 && windows.Length == 0)
        {
            hourlyRate = await connection.ExecuteScalarAsync<decimal>(new CommandDefinition(
                """
                SELECT COALESCE(ROUND(Price / (TIMESTAMPDIFF(MINUTE, StartTime, EndTime) / 60), 2), 0)
                FROM CourtSessions
                WHERE VenueId = @VenueId AND IsDeleted = 0 AND Price > 0
                  AND TIMESTAMPDIFF(MINUTE, StartTime, EndTime) >= 30
                ORDER BY UpdatedAt DESC
                LIMIT 1
                """,
                new { VenueId = venueId },
                tx,
                cancellationToken: cancellationToken));
        }

        if (hourlyRate <= 0 && windows.Length == 0)
        {
            return (Guid.Empty, 0, "This venue has not set an hourly rate yet.");
        }

        var price = CourtRates.Quote(await VenueZoneAsync(connection, venueId, tx, cancellationToken), hourlyRate, startUtc, endUtc, windows);
        if (price <= 0)
        {
            return (Guid.Empty, 0, "This venue has not set an hourly rate for that time.");
        }
        var sessionId = Guid.NewGuid();
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO CourtSessions
                    (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
                VALUES
                    (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                """,
                new { Id = sessionId, VenueId = venueId, CourtId = courtId, StartTime = startUtc, EndTime = endUtc, Price = price },
                tx,
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return (Guid.Empty, 0, "This slot is not available.");
        }

        await tx.CommitAsync(cancellationToken);
        return (sessionId, price, null);
    }

    public async Task<CourtRateWindow[]> ListRateWindowsAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await LoadRateWindowsAsync(connection, venueId, null, cancellationToken);
    }

    public async Task RepriceOpenHoldsAsync(Guid venueId, string timeZone, decimal hourlyRate, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var windows = await LoadRateWindowsAsync(connection, venueId, null, cancellationToken);
        var rows = (await connection.QueryAsync<OpenHoldPriceRow>(new CommandDefinition(
            """
            SELECT b.Id, b.CourtSessionId, cs.StartTime, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.IsDeleted = 0
            WHERE b.VenueId = @VenueId AND b.IsDeleted = 0 AND b.Status = 'pending'
              AND b.GroupId IS NOT NULL AND b.PayGroupId IS NULL
              AND b.DiscountAmount = 0 AND b.PointsRedeemed = 0
              AND cs.StartTime > UTC_TIMESTAMP(6)
              AND NOT EXISTS (
                  SELECT 1 FROM Payments p
                  WHERE p.BookingId = b.Id AND p.Status IN ('pending', 'succeeded', 'partially_refunded', 'refunded')
              )
            """,
            new { VenueId = venueId },
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in rows)
        {
            var price = CourtRates.Quote(timeZone, hourlyRate, row.StartTime, row.EndTime, windows);
            if (price <= 0)
            {
                continue;
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Bookings
                SET SubtotalAmount = @Price, TotalAmount = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND Status = 'pending' AND IsDeleted = 0
                """,
                new { Id = row.Id, Price = price },
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE CourtSessions
                SET Price = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND IsDeleted = 0
                  AND NOT EXISTS (
                      SELECT 1 FROM Bookings b
                      WHERE b.CourtSessionId = CourtSessions.Id AND b.IsDeleted = 0 AND b.Status = 'confirmed'
                  )
                """,
                new { Id = row.CourtSessionId, Price = price },
                cancellationToken: cancellationToken));
        }
    }

    private async Task<CourtRateWindow[]> LoadRateWindowsAsync(MySqlConnection connection, Guid venueId, MySqlTransaction? tx, CancellationToken cancellationToken)
    {
        var rows = await connection.QueryAsync<CourtRateWindow>(new CommandDefinition(
            """
            SELECT CAST(DaysMask AS SIGNED) AS DaysMask,
                   CAST(StartMinute AS SIGNED) AS StartMinute,
                   CAST(EndMinute AS SIGNED) AS EndMinute,
                   HourlyRate, UpdatedAt
            FROM VenueRateWindows
            WHERE VenueId = @VenueId AND IsDeleted = 0
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    private static async Task<string> VenueZoneAsync(MySqlConnection connection, Guid venueId, MySqlTransaction? tx, CancellationToken cancellationToken)
    {
        return await connection.ExecuteScalarAsync<string>(new CommandDefinition(
            "SELECT TimeZone FROM Venues WHERE Id = @VenueId",
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken)) ?? "Australia/Melbourne";
    }

    private static (Guid GroupId, CourtHoldRow[] Rows, string? Error, string? Notice) HoldError(string error) =>
        (Guid.Empty, [], error, null);

    public async Task<(Guid GroupId, CourtHoldRow[] Rows, string? Error, string? Notice)> OpenCourtHoldGroupAsync(
        Guid venueId,
        Guid userId,
        IReadOnlyList<Guid> courtIds,
        decimal hourlyRate,
        string timeZone,
        DateTime startUtc,
        DateTime endUtc,
        int weeks,
        CancellationToken cancellationToken,
        bool payWithin24Hours = false,
        Guid? joinGroupId = null,
        int seriesWeeks = 0,
        bool repeatHold = false)
    {
        if (endUtc <= startUtc)
        {
            return HoldError("The end time must be later than the start time.");
        }

        if (startUtc <= DateTime.UtcNow)
        {
            return HoldError("Choose a time that has not started.");
        }

        if (endUtc - startUtc < TimeSpan.FromMinutes(30))
        {
            return HoldError("Choose at least 30 minutes.");
        }

        if (weeks is < 1 or > 12)
        {
            return HoldError("Choose from 1 to 12 weeks.");
        }

        var ids = courtIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return HoldError("Choose at least one court.");
        }

        if (ids.Length > 16)
        {
            return HoldError("Choose up to 16 courts.");
        }

        Array.Sort(ids);
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var courts = (await connection.QueryAsync<HoldCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName
            FROM Courts
            WHERE Id IN @Ids AND VenueId = @VenueId AND IsDeleted = 0 AND IsActive = 1
            ORDER BY Id
            FOR UPDATE
            """,
            new { Ids = ids, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (courts.Length != ids.Length)
        {
            return HoldError("Choose an open court.");
        }

        var windows = await LoadRateWindowsAsync(connection, venueId, tx, cancellationToken);
        if (hourlyRate <= 0 && windows.Length == 0)
        {
            hourlyRate = await connection.ExecuteScalarAsync<decimal>(new CommandDefinition(
                """
                SELECT COALESCE(ROUND(Price / (TIMESTAMPDIFF(MINUTE, StartTime, EndTime) / 60), 2), 0)
                FROM CourtSessions
                WHERE VenueId = @VenueId AND IsDeleted = 0 AND Price > 0
                  AND TIMESTAMPDIFF(MINUTE, StartTime, EndTime) >= 30
                ORDER BY UpdatedAt DESC
                LIMIT 1
                """,
                new { VenueId = venueId },
                tx,
                cancellationToken: cancellationToken));
        }

        if (hourlyRate <= 0 && windows.Length == 0)
        {
            return HoldError("This venue has not set an hourly rate yet.");
        }

        decimal price = 0;
        var groupId = joinGroupId ?? Guid.NewGuid();
        if (joinGroupId is Guid existingGroup)
        {
            var prior = await connection.QuerySingleOrDefaultAsync<RepeatSettingRow>(new CommandDefinition(
                """
                SELECT CAST(COALESCE(SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                       CAST(RepeatHold AS SIGNED) AS RepeatHold
                FROM Bookings
                WHERE GroupId = @GroupId AND UserId = @UserId AND VenueId = @VenueId AND IsDeleted = 0
                LIMIT 1
                """,
                new { GroupId = existingGroup, UserId = userId, VenueId = venueId },
                tx,
                cancellationToken: cancellationToken));
            if (prior is null)
            {
                return HoldError("That booking was not found.");
            }

            if (prior.SeriesWeeks > 0)
            {
                seriesWeeks = prior.SeriesWeeks;
            }

            repeatHold = prior.RepeatHold == 1;
        }
        var created = new List<CourtHoldRow>();
        var skipped = new HashSet<string>();
        var alreadyOwned = 0;
        var horizon = Math.Max(weeks, seriesWeeks is >= 1 and <= 12 ? seriesWeeks : weeks);
        for (var week = 0; week < horizon; week++)
        {
            var checkStart = startUtc;
            var checkEnd = endUtc;
            if (week > 0 && !ShuttleSync.Api.Booking.VenueClock.TryShiftDays(timeZone, startUtc, endUtc, 7 * week, out checkStart, out checkEnd))
            {
                return HoldError("That weekly time could not be placed.");
            }

            if (checkStart <= DateTime.UtcNow)
            {
                continue;
            }

            var busy = await SocialBusyMessageAsync(connection, tx, venueId, timeZone, ids, checkStart, checkEnd, cancellationToken);
            if (busy is not null)
            {
                return HoldError(busy);
            }
        }

        foreach (var court in courts)
        {
            for (var week = 0; week < weeks; week++)
            {
                var start = startUtc;
                var end = endUtc;
                if (week > 0)
                {
                    if (!ShuttleSync.Api.Booking.VenueClock.TryShiftDays(timeZone, startUtc, endUtc, 7 * week, out start, out end))
                    {
                        return HoldError("That weekly time could not be placed.");
                    }
                }

                if (start <= DateTime.UtcNow)
                {
                    return HoldError($"{court.CourtName} on {HoldWhen(timeZone, start)} has already started. Choose a later time.");
                }

                var owned = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                    """
                    SELECT COUNT(*)
                    FROM Bookings b
                    JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                    WHERE b.GroupId = @GroupId AND b.UserId = @UserId AND b.IsDeleted = 0
                      AND b.Status IN ('pending', 'confirmed')
                      AND cs.CourtId = @CourtId
                      AND cs.StartTime = @StartTime AND cs.EndTime = @EndTime
                    """,
                    new { GroupId = groupId, UserId = userId, CourtId = court.Id, StartTime = start, EndTime = end },
                    tx,
                    cancellationToken: cancellationToken));
                if (owned > 0)
                {
                    alreadyOwned++;
                    continue;
                }

                if (start <= DateTime.UtcNow.AddHours(24))
                {
                    if (!payWithin24Hours)
                    {
                        skipped.Add(HoldWhen(timeZone, start));
                        continue;
                    }
                }

                price = CourtRates.Quote(timeZone, hourlyRate, start, end, windows);
                if (price <= 0)
                {
                    return HoldError("This venue has not set an hourly rate for that time.");
                }

                var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                    """
                    SELECT COUNT(*)
                    FROM CourtClosures
                    WHERE VenueId = @VenueId
                      AND (CourtId = @CourtId OR CourtId IS NULL)
                      AND StartTime < @EndTime AND EndTime > @StartTime
                    """,
                    new { VenueId = venueId, CourtId = court.Id, StartTime = start, EndTime = end },
                    tx,
                    cancellationToken: cancellationToken));
                if (closed > 0)
                {
                    return HoldError($"{court.CourtName} is closed on {HoldWhen(timeZone, start)}. Choose another time.");
                }

                var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
                    """
                    SELECT Id, StartTime, EndTime
                    FROM CourtSessions
                    WHERE CourtId = @CourtId AND IsDeleted = 0
                      AND StartTime < @EndTime AND EndTime > @StartTime
                    FOR UPDATE
                    """,
                    new { CourtId = court.Id, StartTime = start, EndTime = end },
                    tx,
                    cancellationToken: cancellationToken))).ToArray();
                Guid sessionId;
                if (overlaps.Length == 0)
                {
                    sessionId = Guid.NewGuid();
                    try
                    {
                        await connection.ExecuteAsync(new CommandDefinition(
                            """
                            INSERT INTO CourtSessions
                                (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
                            VALUES
                                (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                            """,
                            new { Id = sessionId, VenueId = venueId, CourtId = court.Id, StartTime = start, EndTime = end, Price = price },
                            tx,
                            cancellationToken: cancellationToken));
                    }
                    catch (MySqlException exception) when (exception.Number == 1062)
                    {
                        return HoldError($"{court.CourtName} is not available on {HoldWhen(timeZone, start)}. Someone else just took that time. Choose another time or court.");
                    }
                }
                else if (overlaps.Length == 1 && SameInstant(overlaps[0].StartTime, start) && SameInstant(overlaps[0].EndTime, end))
                {
                    sessionId = overlaps[0].Id;
                    await connection.ExecuteAsync(new CommandDefinition(
                        "UPDATE CourtSessions SET Price = @Price, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                        new { Id = sessionId, Price = price },
                        tx,
                        cancellationToken: cancellationToken));
                    var taken = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                        """
                        SELECT COUNT(*)
                        FROM Bookings
                        WHERE CourtSessionId = @Id AND IsDeleted = 0
                          AND Status NOT IN ('cancelled', 'expired')
                          AND NOT (
                              Status = 'pending'
                              AND HoldExpiresAt IS NOT NULL
                              AND HoldExpiresAt <= UTC_TIMESTAMP(6)
                          )
                        """,
                        new { Id = sessionId },
                        tx,
                        cancellationToken: cancellationToken));
                    if (taken > 0)
                    {
                        var owner = await LiveOwnerAsync(connection, tx, sessionId, cancellationToken);
                        return HoldError(OccupiedMessage(court.CourtName, timeZone, overlaps[0].StartTime, overlaps[0].EndTime, owner, userId));
                    }
                }
                else
                {
                    var busy = await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken);
                    if (busy is not null)
                    {
                        return HoldError(OccupiedMessage(court.CourtName, timeZone, busy.Session.StartTime, busy.Session.EndTime, busy.UserId, userId));
                    }

                    try
                    {
                        sessionId = await ReuseOrInsertSessionAsync(connection, tx, overlaps, venueId, court.Id, start, end, price, cancellationToken);
                    }
                    catch (MySqlException exception) when (exception.Number == 1062)
                    {
                        return HoldError($"{court.CourtName} is not available on {HoldWhen(timeZone, start)}. Someone else just took that time. Choose another time or court.");
                    }
                }

                var bookingId = Guid.NewGuid();
                var hold = start > DateTime.UtcNow.AddHours(24) ? start.AddHours(-24) : DateTime.UtcNow.AddMinutes(30);
                try
                {
                    await connection.ExecuteAsync(new CommandDefinition(
                        """
                        INSERT INTO Bookings
                            (Id, VenueId, UserId, CourtSessionId, GroupId, SeriesWeeks, RepeatHold, Status, SubtotalAmount, DiscountAmount, TotalAmount,
                             PointsRedeemed, PointsValue, HoldExpiresAt, IsDeleted, CreatedAt, UpdatedAt)
                        VALUES
                            (@Id, @VenueId, @UserId, @SessionId, @GroupId, @SeriesWeeks, @RepeatHold, 'pending', @Price, 0, @Price,
                             0, 0, @Hold, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                        """,
                        new
                        {
                            Id = bookingId,
                            VenueId = venueId,
                            UserId = userId,
                            SessionId = sessionId,
                            GroupId = groupId,
                            SeriesWeeks = seriesWeeks > 0 ? seriesWeeks : (int?)null,
                            RepeatHold = repeatHold ? 1 : 0,
                            Price = price,
                            Hold = hold,
                        },
                        tx,
                        cancellationToken: cancellationToken));
                }
                catch (MySqlException exception) when (exception.Number == 1062)
                {
                    return HoldError($"{court.CourtName} is not available on {HoldWhen(timeZone, start)}. Someone else just took that time. Choose another time or court.");
                }

                created.Add(new CourtHoldRow
                {
                    BookingId = bookingId,
                    SessionId = sessionId,
                    CourtName = court.CourtName,
                    StartTime = start,
                    EndTime = end,
                    Price = price,
                    HoldExpiresAt = hold,
                });
            }
        }

        if (created.Count == 0)
        {
            if (alreadyOwned > 0 && skipped.Count == 0)
            {
                await tx.CommitAsync(cancellationToken);
                return (groupId, Array.Empty<CourtHoldRow>(), null, null);
            }

            var when = skipped.FirstOrDefault() ?? HoldWhen(timeZone, startUtc);
            return HoldError(payWithin24Hours
                ? "Choose a session that starts within 24 hours."
                : $"{when} starts within 24 hours. Pay for that week when you register. Nothing was saved.");
        }

        await tx.CommitAsync(cancellationToken);
        var notice = skipped.Count == 0
            ? null
            : $"{string.Join("; ", skipped)} starts within 24 hours, so those courts were not saved. Pay for that week when you register. Later weeks stay held until 24 hours before each session.";
        return (groupId, created.ToArray(), null, notice);
    }

    public async Task ExpireUnpaidPayNowAsync(Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            SET b.Status = 'expired', b.HoldExpiresAt = UTC_TIMESTAMP(6), b.UpdatedAt = UTC_TIMESTAMP(6)
            WHERE b.GroupId = @GroupId AND b.Status = 'pending' AND b.IsDeleted = 0
              AND cs.StartTime <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 24 HOUR)
            """,
            new { GroupId = groupId },
            cancellationToken: cancellationToken));
    }

    public async Task<CourtHoldRow[]> ListCourtHoldGroupAsync(Guid venueId, Guid userId, Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<CourtHoldRow>(new CommandDefinition(
            """
            SELECT b.Id AS BookingId, b.CourtSessionId AS SessionId, c.CourtName, c.CourtNumber,
                   cs.StartTime, cs.EndTime, b.SubtotalAmount AS Price, b.Status, b.HoldExpiresAt,
                   COALESCE(si.Points, 0) AS IncentivePoints
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId
            JOIN Courts c ON c.Id = cs.CourtId
            LEFT JOIN SessionIncentives si ON si.CourtSessionId = cs.Id AND si.IsActive = 1
            WHERE b.GroupId = @GroupId AND b.VenueId = @VenueId AND b.UserId = @UserId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
            ORDER BY cs.StartTime, c.CourtNumber
            """,
            new { GroupId = groupId, VenueId = venueId, UserId = userId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<bool> HoldGroupReleasedAsync(Guid venueId, Guid userId, Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var count = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*)
            FROM Bookings
            WHERE GroupId = @GroupId AND VenueId = @VenueId AND UserId = @UserId AND IsDeleted = 0
              AND Status = 'expired'
            """,
            new { GroupId = groupId, VenueId = venueId, UserId = userId },
            cancellationToken: cancellationToken));
        return count > 0;
    }

    public async Task<ReleasedHoldRow[]> ListReleasedHoldAsync(Guid venueId, Guid userId, Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<ReleasedHoldRow>(new CommandDefinition(
            """
            SELECT cs.CourtId, cs.StartTime, cs.EndTime,
                   CAST(COALESCE(b.SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.GroupId = @GroupId AND b.VenueId = @VenueId AND b.UserId = @UserId AND b.IsDeleted = 0
              AND b.Status = 'expired'
            ORDER BY cs.StartTime
            """,
            new { GroupId = groupId, VenueId = venueId, UserId = userId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<RepeatAddedRow[]> ExtendRepeatHoldsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var groups = (await connection.QueryAsync<RepeatGroupRow>(new CommandDefinition(
            """
            SELECT b.GroupId, b.UserId, b.VenueId,
                   CAST(MAX(COALESCE(b.SeriesWeeks, 0)) AS SIGNED) AS SeriesWeeks,
                   v.TimeZone, v.HourlyRate
            FROM Bookings b
            JOIN Venues v ON v.Id = b.VenueId AND v.IsDeleted = 0
            WHERE b.RepeatHold = 1 AND b.GroupId IS NOT NULL AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
            GROUP BY b.GroupId, b.UserId, b.VenueId, v.TimeZone, v.HourlyRate
            """,
            cancellationToken: cancellationToken))).ToArray();
        var added = new List<RepeatAddedRow>();
        foreach (var group in groups)
        {
            if (group.SeriesWeeks < 1)
            {
                continue;
            }

            var created = await ExtendRepeatGroupAsync(group, cancellationToken);
            added.AddRange(created);
        }

        return added.ToArray();
    }

    public async Task<(bool Ok, string? Message)> SetRepeatHoldAsync(Guid userId, Guid groupId, bool enabled, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var owned = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*)
            FROM Bookings
            WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0
              AND Status IN ('pending', 'confirmed')
            """,
            new { GroupId = groupId, UserId = userId },
            cancellationToken: cancellationToken));
        if (owned == 0)
        {
            return (false, "That booking was not found.");
        }

        if (!enabled)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Bookings
                SET RepeatHold = 0, RepeatNote = NULL, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0
                """,
                new { GroupId = groupId, UserId = userId },
                cancellationToken: cancellationToken));
            return (true, null);
        }

        var series = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT CAST(COALESCE(MAX(SeriesWeeks), 0) AS SIGNED)
            FROM Bookings
            WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0
            """,
            new { GroupId = groupId, UserId = userId },
            cancellationToken: cancellationToken));
        if (series < 1)
        {
            series = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(DISTINCT cs.StartTime)
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                WHERE b.GroupId = @GroupId AND b.UserId = @UserId AND b.IsDeleted = 0
                  AND b.Status IN ('pending', 'confirmed')
                """,
                new { GroupId = groupId, UserId = userId },
                cancellationToken: cancellationToken));
        }

        if (series is < 1 or > 12)
        {
            return (false, "Choose from 1 to 12 weeks before repeating this hold.");
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET SeriesWeeks = @SeriesWeeks, RepeatHold = 1, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0
              AND Status IN ('pending', 'confirmed')
            """,
            new { GroupId = groupId, UserId = userId, SeriesWeeks = series },
            cancellationToken: cancellationToken));
        var group = await connection.QuerySingleOrDefaultAsync<RepeatGroupRow>(new CommandDefinition(
            """
            SELECT b.GroupId, b.UserId, b.VenueId, @SeriesWeeks AS SeriesWeeks, v.TimeZone, v.HourlyRate
            FROM Bookings b
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.GroupId = @GroupId AND b.UserId = @UserId AND b.IsDeleted = 0
            LIMIT 1
            """,
            new { GroupId = groupId, UserId = userId, SeriesWeeks = series },
            cancellationToken: cancellationToken));
        if (group is null)
        {
            return (false, "That booking was not found.");
        }

        await ExtendRepeatGroupAsync(group, cancellationToken);
        return (true, await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            """
            SELECT RepeatNote
            FROM Bookings
            WHERE GroupId = @GroupId AND UserId = @UserId AND RepeatNote IS NOT NULL
            LIMIT 1
            """,
            new { GroupId = groupId, UserId = userId },
            cancellationToken: cancellationToken)));
    }

    private async Task<RepeatAddedRow[]> ExtendRepeatGroupAsync(RepeatGroupRow group, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = (await connection.QueryAsync<RepeatSlotRow>(new CommandDefinition(
            """
            SELECT cs.StartTime, cs.EndTime, cs.CourtId, c.CourtName, b.SubtotalAmount AS Price
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            JOIN Courts c ON c.Id = cs.CourtId
            WHERE b.GroupId = @GroupId AND b.UserId = @UserId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
              AND NOT (
                  b.Status = 'pending'
                  AND b.HoldExpiresAt IS NOT NULL
                  AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
              )
            """,
            new { group.GroupId, group.UserId },
            cancellationToken: cancellationToken))).ToArray();
        if (rows.Length == 0 || group.SeriesWeeks < 1)
        {
            return [];
        }

        var latest = rows.Max(row => row.StartTime);
        var anchor = rows.Where(row => SameInstant(row.StartTime, latest)).ToArray();
        var future = rows.Select(row => row.StartTime).Where(start => start > DateTime.UtcNow).Distinct().Count();
        if (future >= group.SeriesWeeks)
        {
            await SetRepeatNoteAsync(group.GroupId, group.UserId, null, cancellationToken);
            return [];
        }

        var added = new List<RepeatAddedRow>();
        var cursorStart = anchor[0].StartTime;
        var cursorEnd = anchor[0].EndTime;
        var price = anchor.Max(row => row.Price);
        string? blocked = null;
        var guard = group.SeriesWeeks - future;
        for (var step = 0; step < guard; step++)
        {
            if (!ShuttleSync.Api.Booking.VenueClock.TryShiftDays(group.TimeZone, cursorStart, cursorEnd, 7, out var nextStart, out var nextEnd))
            {
                blocked = "The next week could not be placed.";
                break;
            }

            if (nextStart <= DateTime.UtcNow.AddHours(24))
            {
                blocked = $"{HoldWhen(group.TimeZone, nextStart)} starts within 24 hours. Pay for that week when you register. It was not saved.";
                break;
            }

            var created = await InsertRepeatWeekAsync(group, anchor.Select(row => row.CourtId).Distinct().ToArray(), nextStart, nextEnd, price, cancellationToken);
            if (created.Error is not null)
            {
                blocked = created.Error;
                break;
            }

            added.AddRange(created.Rows);
            cursorStart = nextStart;
            cursorEnd = nextEnd;
        }

        await SetRepeatNoteAsync(group.GroupId, group.UserId, blocked, cancellationToken);
        if (added.Count > 0)
        {
            await RepackOverlappingSocialsAsync(group.VenueId, added.Min(row => row.StartTime), added.Max(row => row.EndTime), cancellationToken);
        }

        return added.ToArray();
    }

    private async Task SetRepeatNoteAsync(Guid groupId, Guid userId, string? note, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET RepeatNote = @Note, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0
            """,
            new { GroupId = groupId, UserId = userId, Note = note },
            cancellationToken: cancellationToken));
    }

    private async Task<(RepeatAddedRow[] Rows, string? Error)> InsertRepeatWeekAsync(
        RepeatGroupRow group,
        IReadOnlyList<Guid> courtIds,
        DateTime startUtc,
        DateTime endUtc,
        decimal price,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var courts = (await connection.QueryAsync<HoldCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName
            FROM Courts
            WHERE Id IN @Ids AND VenueId = @VenueId AND IsDeleted = 0 AND IsActive = 1
            ORDER BY Id
            FOR UPDATE
            """,
            new { Ids = courtIds.ToArray(), VenueId = group.VenueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (courts.Length != courtIds.Count())
        {
            return ([], "Choose an open court.");
        }

        var repeatBusy = await SocialBusyMessageAsync(connection, tx, group.VenueId, group.TimeZone, courts.Select(court => court.Id).ToArray(), startUtc, endUtc, cancellationToken);
        if (repeatBusy is not null)
        {
            return ([], repeatBusy);
        }

        var repeatWindows = await LoadRateWindowsAsync(connection, group.VenueId, tx, cancellationToken);
        var quoted = CourtRates.Quote(group.TimeZone, group.HourlyRate, startUtc, endUtc, repeatWindows);
        if (quoted > 0)
        {
            price = quoted;
        }

        if (price <= 0)
        {
            return ([], "This venue has not set an hourly rate yet.");
        }

        var created = new List<RepeatAddedRow>();
        foreach (var court in courts)
        {
            var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*)
                FROM CourtClosures
                WHERE VenueId = @VenueId AND (CourtId = @CourtId OR CourtId IS NULL)
                  AND StartTime < @EndTime AND EndTime > @StartTime
                """,
                new { VenueId = group.VenueId, CourtId = court.Id, StartTime = startUtc, EndTime = endUtc },
                tx,
                cancellationToken: cancellationToken));
            if (closed > 0)
            {
                return ([], $"{court.CourtName} is closed on {HoldWhen(group.TimeZone, startUtc)}.");
            }

            var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
                """
                SELECT Id, StartTime, EndTime
                FROM CourtSessions
                WHERE CourtId = @CourtId AND IsDeleted = 0
                  AND StartTime < @EndTime AND EndTime > @StartTime
                FOR UPDATE
                """,
                new { CourtId = court.Id, StartTime = startUtc, EndTime = endUtc },
                tx,
                cancellationToken: cancellationToken))).ToArray();
            Guid sessionId;
            if (overlaps.Length == 0)
            {
                sessionId = Guid.NewGuid();
                try
                {
                    await connection.ExecuteAsync(new CommandDefinition(
                        """
                        INSERT INTO CourtSessions
                            (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
                        VALUES
                            (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                        """,
                        new { Id = sessionId, VenueId = group.VenueId, CourtId = court.Id, StartTime = startUtc, EndTime = endUtc, Price = price },
                        tx,
                        cancellationToken: cancellationToken));
                }
                catch (MySqlException exception) when (exception.Number == 1062)
                {
                    return ([], $"{court.CourtName} on {HoldWhen(group.TimeZone, startUtc)} is already held.");
                }
            }
            else if (overlaps.Length == 1 && SameInstant(overlaps[0].StartTime, startUtc) && SameInstant(overlaps[0].EndTime, endUtc))
            {
                sessionId = overlaps[0].Id;
                var taken = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                    """
                    SELECT COUNT(*)
                    FROM Bookings
                    WHERE CourtSessionId = @Id AND IsDeleted = 0
                      AND Status NOT IN ('cancelled', 'expired')
                      AND NOT (
                          Status = 'pending'
                          AND HoldExpiresAt IS NOT NULL
                          AND HoldExpiresAt <= UTC_TIMESTAMP(6)
                      )
                    """,
                    new { Id = sessionId },
                    tx,
                    cancellationToken: cancellationToken));
                if (taken > 0)
                {
                    return ([], $"{court.CourtName} on {HoldWhen(group.TimeZone, startUtc)} is already held.");
                }
            }
            else
            {
                var busy = await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken);
                if (busy is not null)
                {
                    return ([], $"{court.CourtName} on {HoldWhen(group.TimeZone, busy.Session.StartTime)} is already held.");
                }

                try
                {
                    sessionId = await ReuseOrInsertSessionAsync(connection, tx, overlaps, group.VenueId, court.Id, startUtc, endUtc, price, cancellationToken);
                }
                catch (MySqlException exception) when (exception.Number == 1062)
                {
                    return ([], $"{court.CourtName} on {HoldWhen(group.TimeZone, startUtc)} is already held.");
                }
            }

            var bookingId = Guid.NewGuid();
            try
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO Bookings
                        (Id, VenueId, UserId, CourtSessionId, GroupId, SeriesWeeks, RepeatHold, Status, SubtotalAmount, DiscountAmount, TotalAmount,
                         PointsRedeemed, PointsValue, HoldExpiresAt, IsDeleted, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @UserId, @SessionId, @GroupId, @SeriesWeeks, 1, 'pending', @Price, 0, @Price,
                         0, 0, @Hold, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    new
                    {
                        Id = bookingId,
                        VenueId = group.VenueId,
                        UserId = group.UserId,
                        SessionId = sessionId,
                        GroupId = group.GroupId,
                        SeriesWeeks = group.SeriesWeeks,
                        Price = price,
                        Hold = startUtc.AddHours(-24),
                    },
                    tx,
                    cancellationToken: cancellationToken));
            }
            catch (MySqlException exception) when (exception.Number == 1062)
            {
                return ([], $"{court.CourtName} on {HoldWhen(group.TimeZone, startUtc)} is already held.");
            }

            created.Add(new RepeatAddedRow { VenueId = group.VenueId, UserId = group.UserId, SessionId = sessionId, StartTime = startUtc, EndTime = endUtc });
        }

        await tx.CommitAsync(cancellationToken);
        return (created.ToArray(), null);
    }

    public async Task<CourtWeekRow[]> ListCourtWeeksAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<CourtWeekRow>(new CommandDefinition(
            """
            SELECT b.Id AS BookingId, b.GroupId, b.Status, b.SubtotalAmount AS Price,
                   CAST(COALESCE(b.SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold, b.RepeatNote,
                   v.Name AS VenueName, v.Slug AS VenueSlug, v.TimeZone, v.Currency,
                   c.Id AS CourtId, c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.GroupId IS NOT NULL AND b.IsDeleted = 0
              AND cs.StartTime > UTC_TIMESTAMP(6)
              AND (
                  b.Status = 'confirmed'
                  OR (b.Status = 'pending' AND b.HoldExpiresAt > UTC_TIMESTAMP(6))
              )
            ORDER BY cs.StartTime, c.CourtNumber
            """,
            new { UserId = userId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<UnpaidHoldRow[]> ListUnpaidHoldsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = (await connection.QueryAsync<UnpaidHoldSourceRow>(new CommandDefinition(
            """
            SELECT b.Id AS BookingId, b.GroupId, v.Name AS VenueName, v.Slug AS VenueSlug, v.TimeZone,
                   cs.StartTime, cs.EndTime,
                   CAST(b.PayGroupId IS NOT NULL AS SIGNED) AS CheckoutStarted
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.IsDeleted = 0
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.IsDeleted = 0 AND b.GroupId IS NOT NULL
              AND b.Status = 'pending'
              AND b.HoldExpiresAt IS NOT NULL
              AND b.HoldExpiresAt > UTC_TIMESTAMP(6)
              AND cs.StartTime > UTC_TIMESTAMP(6)
              AND (
                  b.PayGroupId IS NOT NULL
                  OR cs.StartTime <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 48 HOUR)
              )
              AND NOT (
                  b.PayGroupId IS NULL
                  AND cs.StartTime <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 24 HOUR)
              )
            ORDER BY cs.StartTime
            """,
            new { UserId = userId },
            cancellationToken: cancellationToken))).ToArray();
        return rows
            .GroupBy(row => row.GroupId)
            .Select(group =>
            {
                var first = group.First();
                var week = group.Where(row => SameInstant(row.StartTime, first.StartTime)).ToArray();
                return new UnpaidHoldRow
                {
                    GroupId = first.GroupId,
                    VenueName = first.VenueName,
                    VenueSlug = first.VenueSlug,
                    TimeZone = first.TimeZone,
                    StartTime = first.StartTime,
                    EndTime = first.EndTime,
                    CourtCount = week.Length,
                    BookingIds = week.Select(row => row.BookingId).ToArray(),
                    CheckoutStarted = week.Any(row => row.CheckoutStarted == 1),
                };
            })
            .OrderBy(row => row.StartTime)
            .ToArray();
    }

    private sealed class UnpaidHoldSourceRow
    {
        public Guid BookingId { get; init; }
        public Guid GroupId { get; init; }
        public string VenueName { get; init; } = "";
        public string VenueSlug { get; init; } = "";
        public string TimeZone { get; init; } = "";
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
        public int CheckoutStarted { get; init; }
    }

    public async Task<Guid[]> ListFutureConfirmedAsync(Guid userId, Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var ids = await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT b.Id
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.UserId = @UserId AND b.GroupId = @GroupId AND b.IsDeleted = 0 AND b.Status = 'confirmed'
              AND cs.StartTime > UTC_TIMESTAMP(6)
            """,
            new { UserId = userId, GroupId = groupId },
            cancellationToken: cancellationToken));
        return ids.ToArray();
    }

    public async Task<string?> DeleteUnpaidBookingsAsync(
        Guid userId,
        Guid groupId,
        IReadOnlyList<Guid>? bookingIds,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var wholeGroup = bookingIds is not { Count: > 0 };
        if (wholeGroup)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Bookings
                SET RepeatHold = 0, RepeatNote = NULL, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0
                """,
                new { GroupId = groupId, UserId = userId },
                tx,
                cancellationToken: cancellationToken));
        }

        var ids = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT b.Id
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.UserId = @UserId AND b.GroupId = @GroupId AND b.IsDeleted = 0 AND b.Status = 'pending'
              AND cs.StartTime > UTC_TIMESTAMP(6)
              AND (@Limited = 0 OR b.Id IN @Ids)
            FOR UPDATE
            """,
            new { UserId = userId, GroupId = groupId, Limited = bookingIds is { Count: > 0 } ? 1 : 0, Ids = bookingIds is { Count: > 0 } ? bookingIds.ToArray() : new[] { Guid.Empty } },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (ids.Length == 0)
        {
            await tx.CommitAsync(cancellationToken);
            return wholeGroup ? null : "There is no unfinished booking to delete.";
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Users u
            JOIN (
                SELECT UserId, SUM(Points - PointsRestored) AS Points
                FROM RewardPointRedemptions
                WHERE BookingId IN @Ids AND Points > PointsRestored
                GROUP BY UserId
            ) spent ON spent.UserId = u.Id
            SET u.RewardPoints = u.RewardPoints + spent.Points, u.UpdatedAt = UTC_TIMESTAMP(6)
            """,
            new { Ids = ids },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM RewardPointRedemptions WHERE BookingId IN @Ids",
            new { Ids = ids },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM PromotionRedemptions WHERE BookingId IN @Ids",
            new { Ids = ids },
            tx,
            cancellationToken: cancellationToken));
        var promoIds = (await connection.QueryAsync<Guid>(new CommandDefinition(
            "SELECT DISTINCT PromotionCodeId FROM Bookings WHERE Id IN @Ids AND PromotionCodeId IS NOT NULL",
            new { Ids = ids },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var promoId in promoIds)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE PromotionCodes SET UsedCount = GREATEST(UsedCount - 1, 0), UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                new { Id = promoId },
                tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET Status = 'cancelled',
                CancelledAt = UTC_TIMESTAMP(6),
                CancelledBy = @UserId,
                HoldExpiresAt = UTC_TIMESTAMP(6),
                PayGroupId = NULL,
                PromotionCodeId = NULL,
                PointsRedeemed = 0,
                PointsValue = 0,
                DiscountAmount = 0,
                TotalAmount = SubtotalAmount,
                UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id IN @Ids AND Status = 'pending'
            """,
            new { Ids = ids, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Payments
            SET Status = 'cancelled',
                FailureMessage = 'The unfinished payment was deleted.',
                UpdatedAt = UTC_TIMESTAMP(6)
            WHERE BookingId IN @Ids AND Status = 'pending'
            """,
            new { Ids = ids },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET RepeatHold = 0, RepeatNote = NULL, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0 AND RepeatHold = 1
            """,
            new { GroupId = groupId, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> MoveSessionsAsync(
        Guid userId,
        Guid groupId,
        DateTime currentStartUtc,
        Guid? bookingId,
        string? date,
        string? start,
        string? end,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = (await connection.QueryAsync<MoveSessionRow>(new CommandDefinition(
            """
            SELECT b.Id, b.CourtSessionId, b.Status, b.VenueId, c.Id AS CourtId, c.CourtName,
                   v.TimeZone, v.HourlyRate, cs.StartTime, cs.EndTime,
                   b.DiscountAmount, b.PointsRedeemed
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.IsDeleted = 0
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.GroupId = @GroupId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
              AND cs.StartTime > UTC_TIMESTAMP(6)
              AND (
                  (@OnlyOne = 1 AND b.Id = @BookingId)
                  OR (@OnlyOne = 0 AND ABS(TIMESTAMPDIFF(SECOND, cs.StartTime, @CurrentStart)) < 2)
              )
            """,
            new
            {
                UserId = userId,
                GroupId = groupId,
                OnlyOne = bookingId is null ? 0 : 1,
                BookingId = bookingId ?? Guid.Empty,
                CurrentStart = currentStartUtc,
            },
            cancellationToken: cancellationToken))).ToArray();
        if (rows.Length == 0)
        {
            return "That session was not found.";
        }

        if (string.IsNullOrWhiteSpace(date) || string.IsNullOrWhiteSpace(start) || string.IsNullOrWhiteSpace(end))
        {
            return "Choose a date, a start time, and an end time.";
        }

        if (!ShuttleSync.Api.Booking.VenueClock.TryGetDayWindow(rows[0].TimeZone, date, start, end, out var window, out var clockError))
        {
            return clockError;
        }

        var newStartUtc = window.StartUtc;
        var newEndUtc = window.EndUtc;
        if (newEndUtc <= newStartUtc)
        {
            return "The end time must be later than the start time.";
        }

        if (newStartUtc <= DateTime.UtcNow)
        {
            return "Choose a time that has not started.";
        }

        if (newEndUtc - newStartUtc < TimeSpan.FromMinutes(30))
        {
            return "Choose at least 30 minutes.";
        }

        if (rows.All(row => SameInstant(row.StartTime, newStartUtc) && SameInstant(row.EndTime, newEndUtc)))
        {
            return "That is already the time for this session.";
        }

        var sample = rows[0];
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var social = await SocialBusyMessageAsync(connection, tx, sample.VenueId, sample.TimeZone, rows.Select(row => row.CourtId).ToArray(), newStartUtc, newEndUtc, cancellationToken);
        if (social is not null)
        {
            return social;
        }

        var windows = await LoadRateWindowsAsync(connection, sample.VenueId, tx, cancellationToken);
        var price = CourtRates.Quote(sample.TimeZone, sample.HourlyRate, newStartUtc, newEndUtc, windows);
        if (price <= 0)
        {
            return "This venue has not set an hourly rate for that time.";
        }

        var movingSessions = rows.Select(row => row.CourtSessionId).ToArray();
        var staleTargets = new Dictionary<Guid, Guid>();
        foreach (var row in rows)
        {
            var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*)
                FROM CourtClosures
                WHERE VenueId = @VenueId
                  AND (CourtId = @CourtId OR CourtId IS NULL)
                  AND StartTime < @EndTime AND EndTime > @StartTime
                """,
                new { VenueId = sample.VenueId, CourtId = row.CourtId, StartTime = newStartUtc, EndTime = newEndUtc },
                tx,
                cancellationToken: cancellationToken));
            if (closed > 0)
            {
                return $"{row.CourtName} is closed at that time. Choose another date or time.";
            }

            var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
                """
                SELECT Id, StartTime, EndTime
                FROM CourtSessions
                WHERE CourtId = @CourtId AND IsDeleted = 0
                  AND Id NOT IN @Keep
                  AND StartTime < @EndTime AND EndTime > @StartTime
                FOR UPDATE
                """,
                new { CourtId = row.CourtId, Keep = movingSessions, StartTime = newStartUtc, EndTime = newEndUtc },
                tx,
                cancellationToken: cancellationToken))).ToArray();
            var busy = await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken);
            if (busy is not null)
            {
                return OccupiedMessage(row.CourtName, sample.TimeZone, busy.Session.StartTime, busy.Session.EndTime, busy.UserId, userId);
            }

            var stale = overlaps.FirstOrDefault(item => SameInstant(item.StartTime, newStartUtc));
            if (stale is not null)
            {
                staleTargets[row.Id] = stale.Id;
            }
        }

        foreach (var row in rows)
        {
            if (staleTargets.TryGetValue(row.Id, out var target))
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE CourtSessions SET EndTime = @EndTime, Price = @Price, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = target, EndTime = newEndUtc, Price = price },
                    tx,
                    cancellationToken: cancellationToken));
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE Bookings SET CourtSessionId = @Target, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = row.Id, Target = target },
                    tx,
                    cancellationToken: cancellationToken));
            }
            else try
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE CourtSessions
                    SET StartTime = @StartTime, EndTime = @EndTime, Price = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND IsDeleted = 0
                    """,
                    new { Id = row.CourtSessionId, StartTime = newStartUtc, EndTime = newEndUtc, Price = price },
                    tx,
                    cancellationToken: cancellationToken));
            }
            catch (MySqlException exception) when (exception.Number == 1062)
            {
                return $"{row.CourtName} is not available at that time. Someone else just took it. Choose another time.";
            }

            if (row.Status == "pending" && row.DiscountAmount == 0 && row.PointsRedeemed == 0)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE Bookings
                    SET SubtotalAmount = @Price, TotalAmount = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND Status = 'pending'
                    """,
                    new { Id = row.Id, Price = price },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<(CourtHoldRow[] Added, string? Error)> AddCourtsToHoldWeekAsync(
        Guid venueId,
        Guid userId,
        Guid groupId,
        DateTime startUtc,
        DateTime endUtc,
        IReadOnlyList<Guid> courtIds,
        decimal hourlyRate,
        CancellationToken cancellationToken)
    {
        var ids = courtIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return ([], "Choose a court to add.");
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var sample = await connection.QuerySingleOrDefaultAsync<WeekSampleRow>(new CommandDefinition(
            """
            SELECT b.GroupId, b.SubtotalAmount AS Price, cs.StartTime, cs.EndTime,
                   CAST(COALESCE(b.SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.GroupId = @GroupId AND b.VenueId = @VenueId AND b.UserId = @UserId AND b.IsDeleted = 0
              AND cs.StartTime = @StartTime AND cs.EndTime = @EndTime
              AND b.Status IN ('pending', 'confirmed')
            LIMIT 1
            FOR UPDATE
            """,
            new { GroupId = groupId, VenueId = venueId, UserId = userId, StartTime = startUtc, EndTime = endUtc },
            tx,
            cancellationToken: cancellationToken));
        if (sample is null)
        {
            return ([], "That week was not found.");
        }

        if (sample.StartTime <= DateTime.UtcNow)
        {
            return ([], "This session has already started.");
        }

        if (sample.StartTime <= DateTime.UtcNow.AddHours(24))
        {
            return ([], "This session starts within 24 hours. Pay for it when you register. It was not saved.");
        }

        var zone = await VenueZoneAsync(connection, venueId, tx, cancellationToken);
        var addBusy = await SocialBusyMessageAsync(connection, tx, venueId, zone, ids, sample.StartTime, sample.EndTime, cancellationToken);
        if (addBusy is not null)
        {
            return ([], addBusy);
        }
        var addWindows = await LoadRateWindowsAsync(connection, venueId, tx, cancellationToken);
        var quoted = CourtRates.Quote(zone, hourlyRate, startUtc, endUtc, addWindows);
        var price = quoted > 0 ? quoted : sample.Price;
        if (price <= 0)
        {
            return ([], "This venue has not set an hourly rate yet.");
        }

        var courts = (await connection.QueryAsync<HoldCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName
            FROM Courts
            WHERE Id IN @Ids AND VenueId = @VenueId AND IsDeleted = 0 AND IsActive = 1
            ORDER BY Id
            FOR UPDATE
            """,
            new { Ids = ids, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (courts.Length != ids.Length)
        {
            return ([], "Choose an open court.");
        }

        var added = new List<CourtHoldRow>();
        foreach (var court in courts)
        {
            var already = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*)
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                WHERE b.GroupId = @GroupId AND b.UserId = @UserId AND b.IsDeleted = 0
                  AND cs.CourtId = @CourtId AND cs.StartTime = @StartTime AND cs.EndTime = @EndTime
                  AND b.Status IN ('pending', 'confirmed')
                """,
                new { GroupId = groupId, UserId = userId, CourtId = court.Id, StartTime = startUtc, EndTime = endUtc },
                tx,
                cancellationToken: cancellationToken));
            if (already > 0)
            {
                continue;
            }

            var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
                """
                SELECT Id, StartTime, EndTime
                FROM CourtSessions
                WHERE CourtId = @CourtId AND IsDeleted = 0
                  AND StartTime < @EndTime AND EndTime > @StartTime
                FOR UPDATE
                """,
                new { CourtId = court.Id, StartTime = startUtc, EndTime = endUtc },
                tx,
                cancellationToken: cancellationToken))).ToArray();
            Guid sessionId;
            if (overlaps.Length == 0)
            {
                sessionId = Guid.NewGuid();
                try
                {
                    await connection.ExecuteAsync(new CommandDefinition(
                        """
                        INSERT INTO CourtSessions
                            (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
                        VALUES
                            (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                        """,
                        new { Id = sessionId, VenueId = venueId, CourtId = court.Id, StartTime = startUtc, EndTime = endUtc, Price = price },
                        tx,
                        cancellationToken: cancellationToken));
                }
                catch (MySqlException exception) when (exception.Number == 1062)
                {
                    return ([], $"{court.CourtName} is already held for this week.");
                }
            }
            else if (overlaps.Length == 1 && SameInstant(overlaps[0].StartTime, startUtc) && SameInstant(overlaps[0].EndTime, endUtc))
            {
                sessionId = overlaps[0].Id;
                var taken = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                    """
                    SELECT COUNT(*)
                    FROM Bookings
                    WHERE CourtSessionId = @Id AND IsDeleted = 0
                      AND Status NOT IN ('cancelled', 'expired')
                      AND NOT (
                          Status = 'pending'
                          AND HoldExpiresAt IS NOT NULL
                          AND HoldExpiresAt <= UTC_TIMESTAMP(6)
                      )
                    """,
                    new { Id = sessionId },
                    tx,
                    cancellationToken: cancellationToken));
                if (taken > 0)
                {
                    return ([], $"{court.CourtName} is already held for this week.");
                }
            }
            else
            {
                var busy = await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken);
                if (busy is not null)
                {
                    return ([], $"{court.CourtName} is already held for this week.");
                }

                try
                {
                    sessionId = await ReuseOrInsertSessionAsync(connection, tx, overlaps, venueId, court.Id, startUtc, endUtc, price, cancellationToken);
                }
                catch (MySqlException exception) when (exception.Number == 1062)
                {
                    return ([], $"{court.CourtName} is already held for this week.");
                }
            }

            var bookingId = Guid.NewGuid();
            var hold = startUtc > DateTime.UtcNow.AddHours(24) ? startUtc.AddHours(-24) : DateTime.UtcNow.AddMinutes(30);
            try
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO Bookings
                        (Id, VenueId, UserId, CourtSessionId, GroupId, SeriesWeeks, RepeatHold, Status, SubtotalAmount, DiscountAmount, TotalAmount,
                         PointsRedeemed, PointsValue, HoldExpiresAt, IsDeleted, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @UserId, @SessionId, @GroupId, @SeriesWeeks, @RepeatHold, 'pending', @Price, 0, @Price,
                         0, 0, @Hold, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    new
                    {
                        Id = bookingId,
                        VenueId = venueId,
                        UserId = userId,
                        SessionId = sessionId,
                        GroupId = groupId,
                        SeriesWeeks = sample.SeriesWeeks > 0 ? sample.SeriesWeeks : (int?)null,
                        RepeatHold = sample.RepeatHold,
                        Price = price,
                        Hold = hold,
                    },
                    tx,
                    cancellationToken: cancellationToken));
            }
            catch (MySqlException exception) when (exception.Number == 1062)
            {
                return ([], $"{court.CourtName} is already held for this week.");
            }

            added.Add(new CourtHoldRow { BookingId = bookingId, SessionId = sessionId, CourtName = court.CourtName, StartTime = startUtc, EndTime = endUtc, Price = price, HoldExpiresAt = hold });
        }

        await tx.CommitAsync(cancellationToken);
        return (added.ToArray(), null);
    }

    public async Task RepackOverlappingSocialsAsync(Guid venueId, DateTime startUtc, DateTime endUtc, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var socialIds = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT Id
            FROM PublicSocials
            WHERE VenueId = @VenueId AND IsDeleted = 0
              AND StartTime < @EndTime AND EndTime > @StartTime
              AND StartTime > UTC_TIMESTAMP(6)
            """,
            new { VenueId = venueId, StartTime = startUtc, EndTime = endUtc },
            cancellationToken: cancellationToken))).ToArray();
        foreach (var socialId in socialIds)
        {
            await RepackSocialAsync(socialId, cancellationToken);
        }
    }

    public async Task<SlotRow?> FindSlotAsync(Guid venueId, Guid sessionId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<SlotRow>(
            new CommandDefinition(
                """
                SELECT cs.Id, c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime, cs.Price, si.Points AS IncentivePoints
                FROM CourtSessions cs
                JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId
                LEFT JOIN SessionIncentives si ON si.CourtSessionId = cs.Id AND si.IsActive = 1
                WHERE cs.Id = @Id AND cs.VenueId = @VenueId AND cs.IsDeleted = 0 AND c.IsDeleted = 0
                """,
                new { Id = sessionId, VenueId = venueId },
                cancellationToken: cancellationToken));
    }

    public async Task<PublicIncentiveRow[]> ListPublicIncentivesAsync(Guid venueId, DateOnly day, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PublicIncentiveRow>(new CommandDefinition(
            """
            SELECT Id, Points, StartsOn, EndsOn
            FROM VenueIncentives
            WHERE VenueId = @VenueId AND IsActive = 1
              AND StartsOn <= @Day AND EndsOn >= @Day
            ORDER BY StartsOn
            """,
            new { VenueId = venueId, Day = day.ToDateTime(TimeOnly.MinValue) },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<PromotionRow[]> ListPromotionsAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PromotionRow>(
            new CommandDefinition(
                """
                SELECT Id, Code, DiscountType, DiscountValue, VenueId, ValidFrom, ValidTo
                FROM PromotionCodes
                WHERE IsActive = 1
                  AND ValidFrom <= UTC_TIMESTAMP(6)
                  AND ValidTo > UTC_TIMESTAMP(6)
                  AND (VenueId IS NULL OR VenueId = @VenueId)
                ORDER BY Code
                """,
                new { VenueId = venueId },
                cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<VenueRow[]> ListDashboardVenuesAsync(Guid userId, string role, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var sql = role == "admin"
            ? $"""
              SELECT {VenueColumns}
              FROM Venues
              WHERE IsDeleted = 0
              ORDER BY Name
              """
            : $"""
              SELECT v.Id, v.Name, v.Slug, v.Description, v.Address, v.Suburb, v.State, v.Postcode,
                     v.Country, v.Latitude, v.Longitude, v.Phone, v.Email, v.ImageUrl, v.TimeZone, v.Currency,
                     v.LateCancelFeePercent, v.PointsPerDollar, v.HourlyRate, v.SocialPrice
              FROM Venues v
              JOIN UserVenues uv ON uv.VenueId = v.Id
              WHERE uv.UserId = @UserId AND v.IsDeleted = 0
              ORDER BY v.Name
              """;
        var rows = await connection.QueryAsync<VenueRow>(
            new CommandDefinition(sql, new { UserId = userId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<(BookingListRow[] Items, int Total)> ListBookingsAsync(
        Guid userId,
        string status,
        int offset,
        int pageSize,
        CancellationToken cancellationToken,
        string? venueSlug = null)
    {
        await AwardEndedSocialIncentivesAsync(cancellationToken);
        var filter = status switch
        {
            "past" => "(b.Status IN ('completed', 'no_show') OR (b.Status = 'confirmed' AND cs.StartTime <= UTC_TIMESTAMP(6)))",
            "cancelled" => "b.Status IN ('cancelled', 'expired')",
            _ => "(b.Status = 'confirmed' OR (b.Status = 'pending' AND b.HoldExpiresAt > UTC_TIMESTAMP(6))) AND cs.StartTime > UTC_TIMESTAMP(6) AND b.GroupId IS NULL",
        };
        var socialFilter = status switch
        {
            "past" => "r.Status = 'confirmed' AND s.EndTime <= UTC_TIMESTAMP(6)",
            "cancelled" => "r.Status IN ('cancelled', 'expired')",
            _ => "(r.Status IN ('confirmed', 'waitlist') OR (r.Status = 'pending' AND r.HoldExpiresAt > UTC_TIMESTAMP(6))) AND s.EndTime > UTC_TIMESTAMP(6)",
        };
        const string listed = """
            SELECT b.Id, v.Name AS VenueName, v.Slug AS VenueSlug, v.TimeZone, v.Currency,
                   c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime, b.Status, b.TotalAmount, b.GroupId, NULL AS SocialId,
                   b.SubtotalAmount, b.DiscountAmount, b.PointsRedeemed, b.CreatedAt AS BookedAt, b.CancelledAt,
                   b.ConfirmedAt IS NOT NULL AND b.TotalAmount > 0 AS WasPaid,
                   COALESCE(b.CancelFeePercent,
                       CASE WHEN b.Status = 'cancelled' AND b.ConfirmedAt IS NOT NULL AND b.TotalAmount > 0
                                 AND b.CancelledAt >= cs.StartTime - INTERVAL 24 HOUR
                            THEN v.LateCancelFeePercent ELSE 0 END) AS CancelFeePercent,
                   v.LateCancelFeePercent AS LateFeePercent,
                   CAST((SELECT COALESCE(SUM(a.Points), 0) FROM RewardPointAwards a WHERE a.BookingId = b.Id) AS SIGNED) AS PointsEarned
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.IsDeleted = 0 AND {0}
            UNION ALL
            SELECT r.Id, v.Name, v.Slug, v.TimeZone, v.Currency,
                   CASE WHEN r.Status = 'waitlist' THEN 'Waitlist' ELSE 'Drop-in social' END,
                   COALESCE(c.CourtNumber, 0), s.StartTime, s.EndTime, r.Status, r.Amount, NULL AS GroupId, r.SocialId,
                   r.SubtotalAmount, r.DiscountAmount, r.PointsRedeemed, r.CreatedAt, r.CancelledAt,
                   EXISTS (SELECT 1 FROM PublicSocialPayments p WHERE p.RegistrationId = r.Id AND p.Status IN ('succeeded', 'partially_refunded', 'refunded')),
                   COALESCE(r.CancelFeePercent, 0),
                   v.LateCancelFeePercent,
                   CAST(CASE WHEN r.IncentiveAwardedAt IS NOT NULL THEN COALESCE(r.IncentivePoints, 0) ELSE 0 END AS SIGNED)
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            LEFT JOIN Courts c ON c.Id = r.CourtId
            JOIN Venues v ON v.Id = r.VenueId
            WHERE r.UserId = @UserId AND {1}
            """;
        var combined = string.Format(listed, filter, socialFilter);
        await using var connection = await OpenAsync(cancellationToken);
        if (status is "past" or "cancelled")
        {
            const string sessionKey = "CONCAT(VenueSlug, '|', CAST(StartTime AS CHAR), '|', CAST(EndTime AS CHAR), '|', IF(SocialId IS NULL, 'court', 'social'))";
            var sessions = await connection.ExecuteScalarAsync<int>(
                new CommandDefinition(
                    $"SELECT COUNT(DISTINCT {sessionKey}) FROM ({combined}) entries WHERE (@Venue IS NULL OR VenueSlug = @Venue)",
                    new { UserId = userId, Venue = venueSlug },
                    cancellationToken: cancellationToken));
            var keys = (await connection.QueryAsync<string>(
                new CommandDefinition(
                    $"""
                    SELECT {sessionKey} AS SessionKey
                    FROM ({combined}) entries
                    WHERE (@Venue IS NULL OR VenueSlug = @Venue)
                    GROUP BY SessionKey
                    ORDER BY MAX(StartTime) DESC, SessionKey
                    LIMIT @Take OFFSET @Skip
                    """,
                    new { UserId = userId, Venue = venueSlug, Take = pageSize, Skip = offset },
                    cancellationToken: cancellationToken))).ToArray();
            if (keys.Length == 0)
            {
                return ([], sessions);
            }

            var grouped = await connection.QueryAsync<BookingListRow>(
                new CommandDefinition(
                    $"""
                    SELECT Id, VenueName, VenueSlug, TimeZone, Currency, CourtName, CourtNumber, StartTime, EndTime, Status, TotalAmount, GroupId, SocialId,
                           SubtotalAmount, DiscountAmount, PointsRedeemed, BookedAt, CancelledAt, WasPaid, CancelFeePercent, LateFeePercent, PointsEarned
                    FROM ({combined}) entries
                    WHERE (@Venue IS NULL OR VenueSlug = @Venue) AND {sessionKey} IN @Keys
                    ORDER BY StartTime DESC, CourtNumber
                    """,
                    new { UserId = userId, Venue = venueSlug, Keys = keys },
                    cancellationToken: cancellationToken));
            return (grouped.ToArray(), sessions);
        }

        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                $"SELECT COUNT(*) FROM ({combined}) entries WHERE (@Venue IS NULL OR VenueSlug = @Venue)",
                new { UserId = userId, Venue = venueSlug },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<BookingListRow>(
            new CommandDefinition(
                $"""
                SELECT Id, VenueName, VenueSlug, TimeZone, Currency, CourtName, CourtNumber, StartTime, EndTime, Status, TotalAmount, GroupId, SocialId,
                       SubtotalAmount, DiscountAmount, PointsRedeemed, BookedAt, CancelledAt, WasPaid, CancelFeePercent, LateFeePercent, PointsEarned
                FROM ({combined}) entries
                WHERE (@Venue IS NULL OR VenueSlug = @Venue)
                ORDER BY StartTime DESC
                LIMIT @Take OFFSET @Skip
                """,
                new { UserId = userId, Venue = venueSlug, Take = pageSize, Skip = offset },
                cancellationToken: cancellationToken));
        return (rows.ToArray(), total);
    }

    public async Task<CancelBookingRow?> FindOwnedBookingAsync(Guid userId, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<CancelBookingRow>(
            new CommandDefinition(
                """
                SELECT b.Id, b.Status, b.UserId, cs.StartTime, v.Currency
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                JOIN Venues v ON v.Id = b.VenueId
                WHERE b.Id = @Id AND b.UserId = @UserId AND b.IsDeleted = 0
                """,
                new { Id = bookingId, UserId = userId },
                cancellationToken: cancellationToken));
    }

    public async Task<bool> CancelBookingAsync(Guid userId, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var updated = await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                SET b.Status = 'cancelled',
                    b.CancelledAt = UTC_TIMESTAMP(6),
                    b.CancelledBy = @UserId,
                    b.UpdatedAt = UTC_TIMESTAMP(6)
                WHERE b.Id = @Id
                  AND b.UserId = @UserId
                  AND b.IsDeleted = 0
                  AND b.Status IN ('pending', 'confirmed')
                  AND cs.StartTime > UTC_TIMESTAMP(6)
                """,
                new { Id = bookingId, UserId = userId },
                cancellationToken: cancellationToken));
        return updated == 1;
    }

    private const string CancelledInPayGroup = """
        SELECT cb.PayGroupId, ccs.StartTime, COUNT(*) AS Cancelled,
               GROUP_CONCAT(cc.CourtName ORDER BY cc.CourtNumber SEPARATOR ', ') AS CancelledNames
        FROM Bookings cb
        JOIN CourtSessions ccs ON ccs.Id = cb.CourtSessionId
        JOIN Courts cc ON cc.Id = ccs.CourtId
        WHERE cb.UserId = @UserId AND cb.Status = 'cancelled' AND cb.IsDeleted = 0 AND cb.PayGroupId IS NOT NULL
        GROUP BY cb.PayGroupId, ccs.StartTime
        """;

    public async Task<(RewardAwardRow[] Items, int Total)> ListRewardsAsync(
        Guid userId,
        int offset,
        int pageSize,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        const string awards = $"""
            SELECT CONCAT('court-', MIN(x.Id)) AS Id, 'Court booking' AS Kind, CAST(SUM(x.Points) AS SIGNED) AS Points,
                   MAX(x.AwardedAt) AS AwardedAt, x.VenueName, x.TimeZone,
                   GROUP_CONCAT(x.CourtName ORDER BY x.CourtNumber SEPARATOR ', ') AS CourtName, x.StartTime, x.EndTime,
                   COUNT(*) AS CourtCount, COALESCE(MAX(k.Cancelled), 0) AS CancelledCourts, MAX(k.CancelledNames) AS CancelledCourtNames
            FROM (
                SELECT a.Id, a.Points, a.AwardedAt, v.Name AS VenueName, v.TimeZone, c.CourtName, c.CourtNumber,
                       cs.StartTime, cs.EndTime, b.PayGroupId, COALESCE(b.PayGroupId, b.Id) AS GroupKey
                FROM RewardPointAwards a
                JOIN Bookings b ON b.Id = a.BookingId
                JOIN Venues v ON v.Id = a.VenueId
                JOIN CourtSessions cs ON cs.Id = a.CourtSessionId
                JOIN Courts c ON c.Id = cs.CourtId
                WHERE a.UserId = @UserId
            ) x
            LEFT JOIN ({CancelledInPayGroup}) k ON k.PayGroupId = x.PayGroupId AND k.StartTime = x.StartTime
            GROUP BY x.GroupKey, x.VenueName, x.TimeZone, x.StartTime, x.EndTime
            UNION ALL
            SELECT CONCAT('social-', r.Id), 'Public social', r.IncentivePoints AS Points, r.IncentiveAwardedAt, v.Name, v.TimeZone,
                   COALESCE(c.CourtName, 'Your place'), s.StartTime, s.EndTime, 1, 0, NULL
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Venues v ON v.Id = r.VenueId
            LEFT JOIN Courts c ON c.Id = r.CourtId
            WHERE r.UserId = @UserId AND r.IncentiveAwardedAt IS NOT NULL AND r.IncentivePoints > 0
            UNION ALL
            SELECT CONCAT('friend-', f.Id), 'Friend', f.IncentivePoints AS Points, f.IncentiveAwardedAt, v.Name, v.TimeZone,
                   f.DisplayName, s.StartTime, s.EndTime, 1, 0, NULL
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            JOIN Venues v ON v.Id = f.VenueId
            WHERE r.UserId = @UserId AND f.IncentiveAwardedAt IS NOT NULL AND f.IncentivePoints > 0
            """;
        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                $"SELECT COUNT(*) FROM ({awards}) awards",
                new { UserId = userId },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<RewardAwardRow>(
            new CommandDefinition(
                $"""
                SELECT Id, Kind, Points, AwardedAt, VenueName, TimeZone, CourtName, StartTime, EndTime,
                       CourtCount, CancelledCourts, CancelledCourtNames
                FROM ({awards}) awards
                ORDER BY AwardedAt DESC
                LIMIT @Take OFFSET @Skip
                """,
                new { UserId = userId, Take = pageSize, Skip = offset },
                cancellationToken: cancellationToken));
        return (rows.ToArray(), total);
    }

    public async Task<PendingRewardRow[]> ListPendingRewardsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PendingRewardRow>(new CommandDefinition(
            $"""
            SELECT CONCAT('court-', MIN(x.Id)) AS Id, 'Court booking' AS Kind, CAST(SUM(x.Points) AS SIGNED) AS Points,
                   x.VenueName, x.TimeZone,
                   GROUP_CONCAT(x.CourtName ORDER BY x.CourtNumber SEPARATOR ', ') AS CourtName, x.StartTime, x.EndTime,
                   COUNT(*) AS CourtCount, COALESCE(MAX(k.Cancelled), 0) AS CancelledCourts, MAX(k.CancelledNames) AS CancelledCourtNames
            FROM (
                SELECT b.Id, si.Points, v.Name AS VenueName, v.TimeZone, c.CourtName, c.CourtNumber,
                       cs.StartTime, cs.EndTime, b.PayGroupId, COALESCE(b.PayGroupId, b.Id) AS GroupKey
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                JOIN Courts c ON c.Id = cs.CourtId
                JOIN Venues v ON v.Id = b.VenueId
                JOIN SessionIncentives si ON si.CourtSessionId = cs.Id AND si.IsActive = 1 AND si.Points > 0
                WHERE b.UserId = @UserId AND b.IsDeleted = 0 AND b.Status = 'confirmed'
                  AND cs.EndTime > UTC_TIMESTAMP(6)
                  AND NOT EXISTS (SELECT 1 FROM RewardPointAwards a WHERE a.BookingId = b.Id)
            ) x
            LEFT JOIN ({CancelledInPayGroup}) k ON k.PayGroupId = x.PayGroupId AND k.StartTime = x.StartTime
            GROUP BY x.GroupKey, x.VenueName, x.TimeZone, x.StartTime, x.EndTime
            UNION ALL
            SELECT CONCAT('social-', r.Id), 'Public social', r.IncentivePoints AS Points, v.Name, v.TimeZone,
                   COALESCE(c.CourtName, 'Your place'), s.StartTime, s.EndTime, 1, 0, NULL
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Venues v ON v.Id = r.VenueId
            LEFT JOIN Courts c ON c.Id = r.CourtId
            WHERE r.UserId = @UserId AND r.Status = 'confirmed'
              AND r.IncentivePoints > 0 AND r.IncentiveAwardedAt IS NULL
              AND s.EndTime > UTC_TIMESTAMP(6)
            UNION ALL
            SELECT CONCAT('friend-', f.Id), 'Friend', f.IncentivePoints AS Points, v.Name, v.TimeZone,
                   f.DisplayName, s.StartTime, s.EndTime, 1, 0, NULL
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            JOIN Venues v ON v.Id = f.VenueId
            WHERE r.UserId = @UserId AND f.Status = 'confirmed'
              AND f.IncentivePoints > 0 AND f.IncentiveAwardedAt IS NULL
              AND s.EndTime > UTC_TIMESTAMP(6)
            ORDER BY StartTime, Kind
            """,
            new { UserId = userId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<(PaymentListRow[] Items, int Total)> ListPaymentsAsync(
        Guid userId,
        int offset,
        int pageSize,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        const string courtNames = """
            (
                SELECT GROUP_CONCAT(DISTINCT c2.CourtName ORDER BY c2.CourtNumber SEPARATOR ', ')
                FROM Bookings b2
                JOIN CourtSessions cs2 ON cs2.Id = b2.CourtSessionId
                JOIN Courts c2 ON c2.Id = cs2.CourtId
                WHERE b2.Id = b.Id OR (b.PayGroupId IS NOT NULL AND b2.PayGroupId = b.PayGroupId)
            )
            """;
        const string courtCount = """
            (
                SELECT COUNT(DISTINCT b2.Id)
                FROM Bookings b2
                WHERE b2.Id = b.Id OR (b.PayGroupId IS NOT NULL AND b2.PayGroupId = b.PayGroupId)
            )
            """;
        const string union = $"""
            SELECT p.Id, 'payment' AS Kind, 'Court booking' AS Source, p.Amount, p.Currency, p.Status, COALESCE(p.PaidAt, p.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName, v.TimeZone, {courtNames} AS CourtNames, {courtCount} AS CourtCount, cs.StartTime, cs.EndTime,
                   (SELECT COALESCE(SUM(rf.Amount), 0) FROM Refunds rf WHERE rf.PaymentId = p.Id AND rf.Status IN ('pending', 'succeeded')) AS RefundedAmount
            FROM Payments p
            JOIN Bookings b ON b.Id = p.BookingId
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId
            UNION ALL
            SELECT r.Id, 'refund' AS Kind, 'Court booking' AS Source, r.Amount, p.Currency, r.Status, COALESCE(r.ProcessedAt, r.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName, v.TimeZone, {courtNames} AS CourtNames, {courtCount} AS CourtCount, cs.StartTime, cs.EndTime,
                   0 AS RefundedAmount
            FROM Refunds r
            JOIN Payments p ON p.Id = r.PaymentId
            JOIN Bookings b ON b.Id = p.BookingId
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId
            UNION ALL
            SELECT p.Id, 'payment' AS Kind, 'Public social' AS Source, p.Amount, p.Currency, p.Status, COALESCE(p.PaidAt, p.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName, v.TimeZone, c.CourtName AS CourtNames, 1 AS CourtCount, s.StartTime, s.EndTime,
                   (SELECT COALESCE(SUM(rf.Amount), 0) FROM PublicSocialRefunds rf WHERE rf.PaymentId = p.Id AND rf.Status IN ('pending', 'succeeded')) AS RefundedAmount
            FROM PublicSocialPayments p
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Venues v ON v.Id = r.VenueId
            LEFT JOIN Courts c ON c.Id = r.CourtId
            WHERE r.UserId = @UserId
            UNION ALL
            SELECT sr.Id, 'refund' AS Kind, 'Public social' AS Source, sr.Amount, p.Currency, sr.Status, COALESCE(sr.ProcessedAt, sr.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName, v.TimeZone, c.CourtName AS CourtNames, 1 AS CourtCount, s.StartTime, s.EndTime,
                   0 AS RefundedAmount
            FROM PublicSocialRefunds sr
            JOIN PublicSocialPayments p ON p.Id = sr.PaymentId
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Venues v ON v.Id = r.VenueId
            LEFT JOIN Courts c ON c.Id = r.CourtId
            WHERE r.UserId = @UserId
            """;
        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                $"SELECT COUNT(*) FROM ({union}) entries",
                new { UserId = userId },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<PaymentListRow>(
            new CommandDefinition(
                $"""
                SELECT Id, Kind, Source, Amount, Currency, Status, OccurredAt, VenueName, TimeZone, CourtNames, CourtCount, StartTime, EndTime, RefundedAmount
                FROM ({union}) entries
                ORDER BY OccurredAt DESC
                LIMIT @Take OFFSET @Skip
                """,
                new { UserId = userId, Take = pageSize, Skip = offset },
                cancellationToken: cancellationToken));
        return (rows.ToArray(), total);
    }

    public const int DefaultPlayersPerCourt = 8;
    public const int MaxPlayersPerCourtSetting = 32;

    public static int NormalizePlayersPerCourt(int playersPerCourt) =>
        playersPerCourt < 1 ? DefaultPlayersPerCourt : playersPerCourt;

    public static bool SocialIsFull(int playerCount, int courtLimit, int playersPerCourt, int blockedCourts)
    {
        var openCourts = Math.Max(0, courtLimit - Math.Max(0, blockedCourts));
        return openCourts == 0 || playerCount >= openCourts * NormalizePlayersPerCourt(playersPerCourt);
    }

    public static int AllowedCourtCount(int activeCourts, int? maxCourts)
    {
        if (activeCourts < 1)
        {
            return 0;
        }

        if (maxCourts is null or < 1)
        {
            return activeCourts;
        }

        return Math.Min(activeCourts, maxCourts.Value);
    }

    public async Task<PublicSocialRow?> FindPublicSocialAsync(Guid venueId, Guid socialId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts,
                   (
                       SELECT COUNT(*)
                       FROM PublicSocialRegistrations w
                       WHERE w.SocialId = PublicSocials.Id AND w.Status = 'waitlist' AND w.HoldExpiresAt IS NULL
                   ) + (
                       SELECT COUNT(*)
                       FROM PublicSocialFriends wf
                       WHERE wf.SocialId = PublicSocials.Id AND wf.Status = 'waitlist' AND wf.HoldExpiresAt IS NULL
                   ) AS WaitlistCount,
                   (
                       SELECT COUNT(*)
                       FROM (
                           SELECT c.Id, ROW_NUMBER() OVER (ORDER BY c.CourtNumber) AS CourtRank
                           FROM Courts c
                           WHERE c.VenueId = PublicSocials.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
                       ) ranked
                       WHERE (PublicSocials.MaxCourts IS NULL OR ranked.CourtRank <= PublicSocials.MaxCourts)
                         AND EXISTS (
                             SELECT 1
                             FROM CourtSessions cs
                             JOIN Bookings b ON b.CourtSessionId = cs.Id
                             WHERE cs.CourtId = ranked.Id AND cs.IsDeleted = 0
                               AND cs.StartTime < PublicSocials.EndTime AND cs.EndTime > PublicSocials.StartTime
                               AND b.IsDeleted = 0
                               AND b.Status NOT IN ('cancelled', 'expired')
                               AND NOT (
                                   b.Status = 'pending'
                                   AND b.HoldExpiresAt IS NOT NULL
                                   AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
                               )
                         )
                   ) AS BlockedCourts
            FROM PublicSocials
            WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
            """,
            new { Id = socialId, VenueId = venueId },
            cancellationToken: cancellationToken));
    }

    public async Task<PublicSocialRow[]> ListPublicSocialsAsync(Guid venueId, DateTime rangeStartUtc, DateTime rangeEndUtc, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts,
                   (
                       SELECT COUNT(*)
                       FROM PublicSocialRegistrations w
                       WHERE w.SocialId = PublicSocials.Id AND w.Status = 'waitlist' AND w.HoldExpiresAt IS NULL
                   ) + (
                       SELECT COUNT(*)
                       FROM PublicSocialFriends wf
                       WHERE wf.SocialId = PublicSocials.Id AND wf.Status = 'waitlist' AND wf.HoldExpiresAt IS NULL
                   ) AS WaitlistCount,
                   (
                       SELECT COUNT(*)
                       FROM (
                           SELECT c.Id, ROW_NUMBER() OVER (ORDER BY c.CourtNumber) AS CourtRank
                           FROM Courts c
                           WHERE c.VenueId = PublicSocials.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
                       ) ranked
                       WHERE (PublicSocials.MaxCourts IS NULL OR ranked.CourtRank <= PublicSocials.MaxCourts)
                         AND EXISTS (
                             SELECT 1
                             FROM CourtSessions cs
                             JOIN Bookings b ON b.CourtSessionId = cs.Id
                             WHERE cs.CourtId = ranked.Id AND cs.IsDeleted = 0
                               AND cs.StartTime < PublicSocials.EndTime AND cs.EndTime > PublicSocials.StartTime
                               AND b.IsDeleted = 0
                               AND b.Status NOT IN ('cancelled', 'expired')
                               AND NOT (
                                   b.Status = 'pending'
                                   AND b.HoldExpiresAt IS NOT NULL
                                   AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
                               )
                         )
                   ) AS BlockedCourts
            FROM PublicSocials
            WHERE VenueId = @VenueId AND IsDeleted = 0
              AND StartTime < @RangeEndUtc AND EndTime > @RangeStartUtc
            ORDER BY StartTime
            """,
            new { VenueId = venueId, RangeStartUtc = rangeStartUtc, RangeEndUtc = rangeEndUtc },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<PublicSocialSeatRow[]> ListPublicSocialSeatsAsync(IReadOnlyCollection<Guid> socialIds, CancellationToken cancellationToken)
    {
        if (socialIds.Count == 0)
        {
            return [];
        }

        await using var connection = await OpenAsync(cancellationToken);
        var unpacked = await FindUnpackedSocialsAsync(connection, null, socialIds, cancellationToken);
        if (unpacked.Length > 0)
        {
            await using var tx = await connection.BeginTransactionAsync(cancellationToken);
            foreach (var socialId in unpacked)
            {
                await RepackSocialCourtsAsync(connection, tx, socialId, cancellationToken);
            }

            await tx.CommitAsync(cancellationToken);
        }

        return await ReadConfirmedSocialSeatsAsync(connection, socialIds, cancellationToken);
    }

    public async Task<SocialRosterNameRow[]> ListSocialRosterAsync(Guid socialId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<SocialRosterNameRow>(new CommandDefinition(
            """
            SELECT c.CourtName, c.CourtNumber, COALESCE(NULLIF(TRIM(u.DisplayName), ''), 'Player') AS Name
            FROM PublicSocialRegistrations r
            JOIN Users u ON u.Id = r.UserId
            JOIN Courts c ON c.Id = r.CourtId
            WHERE r.SocialId = @SocialId AND r.Status = 'confirmed'
            UNION ALL
            SELECT c.CourtName, c.CourtNumber, f.DisplayName AS Name
            FROM PublicSocialFriends f
            JOIN Courts c ON c.Id = f.CourtId
            WHERE f.SocialId = @SocialId AND f.Status = 'confirmed'
            ORDER BY CourtNumber, Name
            """,
            new { SocialId = socialId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    private static async Task<PublicSocialSeatRow[]> ReadConfirmedSocialSeatsAsync(
        MySqlConnection connection,
        IReadOnlyCollection<Guid> socialIds,
        CancellationToken cancellationToken)
    {
        var players = (await connection.QueryAsync<PublicSocialSeatRow>(new CommandDefinition(
            """
            SELECT r.SocialId, r.UserId, c.Id AS CourtId, c.CourtName, c.CourtNumber
            FROM PublicSocialRegistrations r
            JOIN Courts c ON c.Id = r.CourtId
            WHERE r.SocialId IN @SocialIds AND r.Status = 'confirmed'
            """,
            new { SocialIds = socialIds },
            cancellationToken: cancellationToken))).ToArray();
        var friends = (await connection.QueryAsync<FriendSeatRow>(new CommandDefinition(
            """
            SELECT f.SocialId, c.Id AS CourtId, c.CourtName, c.CourtNumber
            FROM PublicSocialFriends f
            JOIN Courts c ON c.Id = f.CourtId
            WHERE f.SocialId IN @SocialIds AND f.Status = 'confirmed'
            """,
            new { SocialIds = socialIds },
            cancellationToken: cancellationToken))).ToArray();
        return players.Concat(friends.Select(seat => new PublicSocialSeatRow
        {
            SocialId = seat.SocialId,
            UserId = Guid.Empty,
            CourtId = seat.CourtId,
            CourtName = seat.CourtName,
            CourtNumber = seat.CourtNumber,
        })).ToArray();
    }

    private static async Task<Guid[]> FindUnpackedSocialsAsync(
        MySqlConnection connection,
        MySqlTransaction? tx,
        IReadOnlyCollection<Guid> socialIds,
        CancellationToken cancellationToken)
    {
        var rows = (await connection.QueryAsync<SocialCourtFillRow>(new CommandDefinition(
            """
            SELECT s.Id AS SocialId, c.CourtNumber, s.PlayersPerCourt, s.MaxCourts,
                   (
                       SELECT COUNT(*)
                       FROM PublicSocialRegistrations r
                       WHERE r.SocialId = s.Id AND r.CourtId = c.Id
                         AND (
                             r.Status = 'confirmed'
                             OR (r.Status = 'pending' AND r.HoldExpiresAt > UTC_TIMESTAMP(6))
                         )
                   ) + (
                       SELECT COUNT(*)
                       FROM PublicSocialFriends f
                       WHERE f.SocialId = s.Id AND f.CourtId = c.Id
                         AND (
                             f.Status = 'confirmed'
                             OR (f.Status = 'pending' AND f.HoldExpiresAt > UTC_TIMESTAMP(6))
                         )
                   ) AS Players,
                   EXISTS (
                       SELECT 1
                       FROM CourtSessions cs
                       JOIN Bookings b ON b.CourtSessionId = cs.Id
                       WHERE cs.CourtId = c.Id AND cs.IsDeleted = 0
                         AND cs.StartTime < s.EndTime AND cs.EndTime > s.StartTime
                         AND b.IsDeleted = 0
                         AND b.Status NOT IN ('cancelled', 'expired')
                         AND NOT (
                             b.Status = 'pending'
                             AND b.HoldExpiresAt IS NOT NULL
                             AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
                         )
                   ) AS Blocked
            FROM PublicSocials s
            JOIN Courts c ON c.VenueId = s.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
            WHERE s.Id IN @SocialIds AND s.IsDeleted = 0 AND s.StartTime > UTC_TIMESTAMP(6)
            """,
            new { SocialIds = socialIds },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        return rows
            .GroupBy(row => row.SocialId)
            .Where(group =>
            {
                var courts = group.OrderBy(row => row.CourtNumber).ToArray();
                var lastOccupied = -1;
                for (var index = courts.Length - 1; index >= 0; index--)
                {
                    if (courts[index].Players > 0)
                    {
                        lastOccupied = index;
                        break;
                    }
                }

                if (lastOccupied < 0)
                {
                    return false;
                }

                if (courts.Any(row => row.Blocked && row.Players > 0))
                {
                    return true;
                }

                var perCourt = NormalizePlayersPerCourt(courts[0].PlayersPerCourt);
                var allowed = AllowedCourtCount(courts.Length, courts[0].MaxCourts);
                if (lastOccupied >= allowed)
                {
                    return true;
                }

                for (var index = 0; index < lastOccupied; index++)
                {
                    if (courts[index].Players != perCourt)
                    {
                        return true;
                    }
                }

                return courts[lastOccupied].Players > perCourt;
            })
            .Select(group => group.Key)
            .ToArray();
    }

    private static async Task RepackSocialCourtsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid socialId,
        CancellationToken cancellationToken)
    {
        var room = await connection.QuerySingleOrDefaultAsync<SocialRoomRow>(new CommandDefinition(
            """
            SELECT VenueId, PlayersPerCourt, MaxCourts, StartTime, EndTime
            FROM PublicSocials
            WHERE Id = @Id AND IsDeleted = 0 AND StartTime > UTC_TIMESTAMP(6)
            """,
            new { Id = socialId },
            tx,
            cancellationToken: cancellationToken));
        if (room is null)
        {
            return;
        }

        var courts = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT Id
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            FOR UPDATE
            """,
            new { VenueId = room.VenueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        var allowedCount = AllowedCourtCount(courts.Length, room.MaxCourts);
        if (allowedCount == 0)
        {
            return;
        }

        var blocked = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT DISTINCT cs.CourtId
            FROM CourtSessions cs
            JOIN Bookings b ON b.CourtSessionId = cs.Id AND b.VenueId = cs.VenueId
            WHERE cs.VenueId = @VenueId AND cs.IsDeleted = 0
              AND cs.StartTime < @EndTime AND cs.EndTime > @StartTime
              AND b.IsDeleted = 0
              AND b.Status NOT IN ('cancelled', 'expired')
              AND NOT (
                  b.Status = 'pending'
                  AND b.HoldExpiresAt IS NOT NULL
                  AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
              )
            """,
            new { VenueId = room.VenueId, StartTime = room.StartTime, EndTime = room.EndTime },
            tx,
            cancellationToken: cancellationToken))).ToHashSet();
        var allowed = courts.Take(allowedCount).Where(id => !blocked.Contains(id)).ToArray();
        if (allowed.Length == 0)
        {
            return;
        }
        var perCourt = NormalizePlayersPerCourt(room.PlayersPerCourt);

        var registrations = (await connection.QueryAsync<SocialSeatRow>(new CommandDefinition(
            """
            SELECT Id, CourtId, CreatedAt
            FROM PublicSocialRegistrations
            WHERE SocialId = @SocialId
              AND (
                  Status = 'confirmed'
                  OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
              )
            FOR UPDATE
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        var friends = (await connection.QueryAsync<SocialSeatRow>(new CommandDefinition(
            """
            SELECT Id, CourtId, CreatedAt
            FROM PublicSocialFriends
            WHERE SocialId = @SocialId
              AND (
                  Status = 'confirmed'
                  OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
              )
            FOR UPDATE
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        var seats = registrations.Select(row => (Row: row, Friend: false))
            .Concat(friends.Select(row => (Row: row, Friend: true)))
            .OrderBy(item => item.Row.CreatedAt)
            .ThenBy(item => item.Row.Id)
            .ToArray();
        for (var index = 0; index < seats.Length; index++)
        {
            var courtId = allowed[Math.Min(index / perCourt, allowed.Length - 1)];
            if (seats[index].Row.CourtId == courtId)
            {
                continue;
            }

            await connection.ExecuteAsync(new CommandDefinition(
                seats[index].Friend
                    ? "UPDATE PublicSocialFriends SET CourtId = @CourtId WHERE Id = @Id"
                    : "UPDATE PublicSocialRegistrations SET CourtId = @CourtId WHERE Id = @Id",
                new { seats[index].Row.Id, CourtId = courtId },
                tx,
                cancellationToken: cancellationToken));
        }
    }

    public async Task RepackSocialAsync(Guid socialId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await FillSocialWaitlistAsync(connection, tx, socialId, cancellationToken);
        await RepackSocialCourtsAsync(connection, tx, socialId, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }

    public async Task FillOpenWaitlistsAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var socialIds = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT s.Id
            FROM PublicSocials s
            WHERE s.VenueId = @VenueId AND s.IsDeleted = 0 AND s.StartTime > UTC_TIMESTAMP(6)
              AND (
                  EXISTS (
                      SELECT 1 FROM PublicSocialRegistrations w
                      WHERE w.SocialId = s.Id AND w.Status = 'waitlist' AND w.HoldExpiresAt IS NULL
                  )
                  OR EXISTS (
                      SELECT 1 FROM PublicSocialFriends f
                      WHERE f.SocialId = s.Id AND f.Status = 'waitlist' AND f.HoldExpiresAt IS NULL
                  )
              )
            """,
            new { VenueId = venueId },
            cancellationToken: cancellationToken))).ToArray();
        if (socialIds.Length == 0)
        {
            return;
        }

        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        foreach (var socialId in socialIds)
        {
            await FillSocialWaitlistAsync(connection, tx, socialId, cancellationToken);
            await RepackSocialCourtsAsync(connection, tx, socialId, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
    }

    private static async Task FillSocialWaitlistAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid socialId,
        CancellationToken cancellationToken)
    {
        for (var step = 0; step < 2000; step++)
        {
            if (!await PromoteNextWaitlistAsync(connection, tx, socialId, cancellationToken))
            {
                return;
            }
        }
    }

    private static async Task<bool> PromoteNextWaitlistAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid socialId,
        CancellationToken cancellationToken)
    {
        var room = await connection.QuerySingleOrDefaultAsync<SocialRoomRow>(new CommandDefinition(
            """
            SELECT VenueId, PlayersPerCourt, MaxCourts, StartTime, EndTime
            FROM PublicSocials
            WHERE Id = @Id AND IsDeleted = 0 AND StartTime > UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            new { Id = socialId },
            tx,
            cancellationToken: cancellationToken));
        if (room is null)
        {
            return false;
        }

        var nextPlayer = await connection.QuerySingleOrDefaultAsync<WaitlistCandidateRow>(new CommandDefinition(
            """
            SELECT Id, CreatedAt
            FROM PublicSocialRegistrations
            WHERE SocialId = @SocialId AND Status = 'waitlist' AND HoldExpiresAt IS NULL
            ORDER BY CreatedAt, Id
            LIMIT 1
            FOR UPDATE
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken));
        var nextFriend = await connection.QuerySingleOrDefaultAsync<WaitlistCandidateRow>(new CommandDefinition(
            """
            SELECT Id, CreatedAt
            FROM PublicSocialFriends
            WHERE SocialId = @SocialId AND Status = 'waitlist' AND HoldExpiresAt IS NULL
            ORDER BY CreatedAt, Id
            LIMIT 1
            FOR UPDATE
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken));
        var promoteFriend = nextFriend is not null && (nextPlayer is null || nextFriend.CreatedAt < nextPlayer.CreatedAt || (nextFriend.CreatedAt == nextPlayer.CreatedAt && nextFriend.Id.CompareTo(nextPlayer.Id) < 0));
        var nextId = promoteFriend ? nextFriend?.Id : nextPlayer?.Id;
        if (nextId is null)
        {
            return false;
        }

        var counts = (await connection.QueryAsync<SocialCourtCountRow>(new CommandDefinition(
            """
            SELECT CourtId, COUNT(*) AS Players
            FROM (
                SELECT CourtId
                FROM PublicSocialRegistrations
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
                UNION ALL
                SELECT CourtId
                FROM PublicSocialFriends
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
            ) occupied
            GROUP BY CourtId
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken))).ToDictionary(row => row.CourtId, row => row.Players);
        var courts = (await connection.QueryAsync<PublicCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber, SurfaceType, ImageUrl, Description
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            FOR UPDATE
            """,
            new { VenueId = room.VenueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        await BlockPrivateCourtsAsync(connection, tx, room.VenueId, room.StartTime, room.EndTime, counts, room.PlayersPerCourt, cancellationToken);
        var court = NextSocialCourt(courts, counts, room.PlayersPerCourt, room.MaxCourts);
        if (court is null)
        {
            return false;
        }

        var promoted = await connection.ExecuteAsync(new CommandDefinition(
            promoteFriend
                ? """
                  UPDATE PublicSocialFriends
                  SET Status = 'confirmed', CourtId = @CourtId, ConfirmedAt = UTC_TIMESTAMP(6), HoldExpiresAt = NULL
                  WHERE Id = @Id AND Status = 'waitlist' AND HoldExpiresAt IS NULL
                  """
                : """
                  UPDATE PublicSocialRegistrations
                  SET Status = 'confirmed', CourtId = @CourtId, ConfirmedAt = UTC_TIMESTAMP(6), HoldExpiresAt = NULL
                  WHERE Id = @Id AND Status = 'waitlist' AND HoldExpiresAt IS NULL
                  """,
            new { Id = nextId, CourtId = court.Id },
            tx,
            cancellationToken: cancellationToken));
        return promoted == 1;
    }

    private static async Task BlockPrivateCourtsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        DateTime startUtc,
        DateTime endUtc,
        Dictionary<Guid, int> counts,
        int playersPerCourt,
        CancellationToken cancellationToken)
    {
        var blocked = await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT DISTINCT cs.CourtId
            FROM CourtSessions cs
            JOIN Bookings b ON b.CourtSessionId = cs.Id AND b.VenueId = cs.VenueId
            WHERE cs.VenueId = @VenueId AND cs.IsDeleted = 0
              AND cs.StartTime < @EndTime AND cs.EndTime > @StartTime
              AND b.IsDeleted = 0
              AND b.Status NOT IN ('cancelled', 'expired')
              AND NOT (
                  b.Status = 'pending'
                  AND b.HoldExpiresAt IS NOT NULL
                  AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
              )
            """,
            new { VenueId = venueId, StartTime = startUtc, EndTime = endUtc },
            tx,
            cancellationToken: cancellationToken));
        var full = NormalizePlayersPerCourt(playersPerCourt);
        foreach (var courtId in blocked)
        {
            counts[courtId] = Math.Max(counts.GetValueOrDefault(courtId), full);
        }
    }

    private static PublicCourtRow? NextSocialCourt(
        IReadOnlyList<PublicCourtRow> courts,
        IReadOnlyDictionary<Guid, int> counts,
        int playersPerCourt,
        int? maxCourts)
    {
        var perCourt = NormalizePlayersPerCourt(playersPerCourt);
        var allowed = AllowedCourtCount(courts.Count, maxCourts);
        for (var index = 0; index < allowed; index++)
        {
            if (counts.GetValueOrDefault(courts[index].Id) < perCourt)
            {
                return courts[index];
            }
        }

        return null;
    }

    private static int OpenSocialPlaces(
        IReadOnlyList<PublicCourtRow> courts,
        IReadOnlyDictionary<Guid, int> counts,
        int playersPerCourt,
        int? maxCourts)
    {
        var perCourt = NormalizePlayersPerCourt(playersPerCourt);
        var allowed = AllowedCourtCount(courts.Count, maxCourts);
        var open = 0;
        for (var index = 0; index < allowed; index++)
        {
            open += Math.Max(0, perCourt - counts.GetValueOrDefault(courts[index].Id));
        }

        return open;
    }

    public async Task ExpirePublicSocialHoldsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<SocialPointRow>(new CommandDefinition(
            """
            SELECT Id, UserId, PointsRedeemed
            FROM PublicSocialRegistrations
            WHERE Status IN ('pending', 'waitlist')
              AND HoldExpiresAt IS NOT NULL
              AND HoldExpiresAt <= UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            transaction: tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in rows)
        {
            await RestoreSocialPointsAsync(connection, tx, row.UserId, row.PointsRedeemed, cancellationToken);
        }

        if (rows.Length > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Status = 'pending' AND FriendGroupId IS NULL AND RegistrationId IN @Ids
                """,
                new { Ids = rows.Select(row => row.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
                WHERE Id IN @Ids AND Status = 'pending'
                """,
                new { Ids = rows.Select(row => row.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
        }

        await ExpireFriendHoldsAsync(connection, tx, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }

    public async Task AwardEndedCourtIncentivesAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<CourtPointAwardRow>(new CommandDefinition(
            """
            SELECT b.Id AS BookingId, b.UserId, b.VenueId, b.CourtSessionId,
                   si.Id AS SessionIncentiveId, si.Points
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId
            JOIN SessionIncentives si ON si.CourtSessionId = cs.Id AND si.IsActive = 1
            WHERE b.IsDeleted = 0
              AND b.Status IN ('confirmed', 'completed')
              AND si.Points > 0
              AND cs.EndTime <= UTC_TIMESTAMP(6)
              AND NOT EXISTS (SELECT 1 FROM RewardPointAwards a WHERE a.BookingId = b.Id)
            FOR UPDATE
            """,
            transaction: tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in rows)
        {
            var inserted = await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO RewardPointAwards
                    (Id, UserId, VenueId, CourtSessionId, BookingId, SessionIncentiveId, Points, AwardedAt)
                SELECT @Id, @UserId, @VenueId, @CourtSessionId, @BookingId, @SessionIncentiveId, @Points, UTC_TIMESTAMP(6)
                FROM DUAL
                WHERE NOT EXISTS (SELECT 1 FROM RewardPointAwards WHERE BookingId = @BookingId)
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    row.UserId,
                    row.VenueId,
                    row.CourtSessionId,
                    row.BookingId,
                    row.SessionIncentiveId,
                    row.Points,
                },
                tx,
                cancellationToken: cancellationToken));
            if (inserted != 1)
            {
                continue;
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @UserId
                """,
                new { row.UserId, row.Points },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
    }

    private static readonly SemaphoreSlim AwardGate = new(1, 1);

    public async Task AwardEndedSocialIncentivesAsync(CancellationToken cancellationToken)
    {
        // Pages load several endpoints at once, and parallel award sweeps lock the same bookings in different orders.
        if (!await AwardGate.WaitAsync(0, cancellationToken))
        {
            return;
        }

        try
        {
            await AwardEndedIncentivesOnceAsync(cancellationToken);
        }
        catch (MySqlException exception) when (exception.Number is 1213 or 1205)
        {
            // Awards are idempotent, so the next request finishes them.
        }
        finally
        {
            AwardGate.Release();
        }
    }

    private async Task AwardEndedIncentivesOnceAsync(CancellationToken cancellationToken)
    {
        await AwardEndedCourtIncentivesAsync(cancellationToken);
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<SocialPointRow>(new CommandDefinition(
            """
            SELECT r.Id, r.UserId, r.IncentivePoints AS PointsRedeemed
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            WHERE r.Status = 'confirmed'
              AND r.IncentivePoints > 0
              AND r.IncentiveAwardedAt IS NULL
              AND s.EndTime <= UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            transaction: tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in rows)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @UserId
                """,
                new { UserId = row.UserId, Points = row.PointsRedeemed },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET IncentiveAwardedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND IncentiveAwardedAt IS NULL
                """,
                new { Id = row.Id },
                tx,
                cancellationToken: cancellationToken));
        }

        var friendAwards = (await connection.QueryAsync<FriendIncentiveRow>(new CommandDefinition(
            """
            SELECT f.Id, r.UserId, f.VenueId, v.TimeZone, s.StartTime, f.IncentivePoints AS PointsRedeemed
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            JOIN Venues v ON v.Id = f.VenueId
            WHERE f.Status = 'confirmed'
              AND f.IncentiveAwardedAt IS NULL
              AND s.EndTime <= UTC_TIMESTAMP(6)
              AND (f.IncentivePoints IS NULL OR f.IncentivePoints > 0)
            FOR UPDATE
            """,
            transaction: tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in friendAwards)
        {
            var points = row.PointsRedeemed ?? await SocialIncentivePointsAsync(connection, tx, row.VenueId, row.TimeZone, row.StartTime, cancellationToken);
            if (points <= 0)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE PublicSocialFriends
                    SET IncentivePoints = 0, IncentiveAwardedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND IncentiveAwardedAt IS NULL
                    """,
                    new { Id = row.Id },
                    tx,
                    cancellationToken: cancellationToken));
                continue;
            }

            if (row.PointsRedeemed is null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE PublicSocialFriends SET IncentivePoints = @Points WHERE Id = @Id",
                    new { Id = row.Id, Points = points },
                    tx,
                    cancellationToken: cancellationToken));
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @UserId
                """,
                new { UserId = row.UserId, Points = points },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialFriends
                SET IncentiveAwardedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND IncentiveAwardedAt IS NULL
                """,
                new { Id = row.Id },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        await RollWeeklySocialsAsync(cancellationToken);
    }

    public async Task RollWeeklySocialsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var due = (await connection.QueryAsync<WeeklySocialRow>(new CommandDefinition(
            """
            SELECT s.Id, s.VenueId, s.StartTime, s.EndTime, s.Price, s.PlayersPerCourt, s.MaxCourts, v.TimeZone
            FROM PublicSocials s
            JOIN Venues v ON v.Id = s.VenueId
            WHERE s.RepeatWeekly = 1 AND s.IsDeleted = 0 AND s.SuccessorId IS NULL
              AND s.EndTime <= UTC_TIMESTAMP(6)
            """,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in due)
        {
            DateTime nextStart = default;
            DateTime nextEnd = default;
            var placed = false;
            for (var weeks = 1; weeks <= 52; weeks++)
            {
                if (!ShuttleSync.Api.Booking.VenueClock.TryShiftDays(row.TimeZone, row.StartTime, row.EndTime, 7 * weeks, out nextStart, out nextEnd))
                {
                    break;
                }

                if (nextEnd > DateTime.UtcNow)
                {
                    placed = true;
                    break;
                }
            }

            if (!placed)
            {
                continue;
            }

            await using var tx = await connection.BeginTransactionAsync(cancellationToken);
            var open = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*) FROM PublicSocials
                WHERE Id = @Id AND SuccessorId IS NULL AND IsDeleted = 0
                FOR UPDATE
                """,
                new { Id = row.Id },
                tx,
                cancellationToken: cancellationToken));
            if (open == 0)
            {
                await tx.CommitAsync(cancellationToken);
                continue;
            }

            var existingId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
                """
                SELECT Id FROM PublicSocials
                WHERE VenueId = @VenueId AND IsDeleted = 0
                  AND StartTime < @EndTime AND EndTime > @StartTime
                LIMIT 1
                """,
                new { row.VenueId, StartTime = nextStart, EndTime = nextEnd },
                tx,
                cancellationToken: cancellationToken));
            var successorId = existingId ?? Guid.NewGuid();
            if (existingId is null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO PublicSocials
                        (Id, VenueId, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts, RepeatWeekly, IsDeleted, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @StartTime, @EndTime, @Price, @PlayersPerCourt, @MaxCourts, 1, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    new
                    {
                        Id = successorId,
                        row.VenueId,
                        StartTime = nextStart,
                        EndTime = nextEnd,
                        row.Price,
                        row.PlayersPerCourt,
                        row.MaxCourts,
                    },
                    tx,
                    cancellationToken: cancellationToken));
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocials
                SET SuccessorId = @SuccessorId, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND SuccessorId IS NULL
                """,
                new { Id = row.Id, SuccessorId = successorId },
                tx,
                cancellationToken: cancellationToken));
            await tx.CommitAsync(cancellationToken);
        }
    }

    public async Task<OpenSocialRow[]> ListOpenSocialsAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<OpenSocialRow>(new CommandDefinition(
            """
            SELECT s.Id, s.StartTime, s.EndTime, s.Price, s.PlayersPerCourt, s.MaxCourts, s.RepeatWeekly,
                   COUNT(r.Id) + (
                       SELECT COUNT(*) FROM PublicSocialFriends f
                       WHERE f.SocialId = s.Id AND f.Status = 'confirmed'
                   ) AS PlayerCount,
                   (
                       SELECT COUNT(*)
                       FROM PublicSocialRegistrations w
                       WHERE w.SocialId = s.Id AND w.Status = 'waitlist' AND w.HoldExpiresAt IS NULL
                   ) + (
                       SELECT COUNT(*)
                       FROM PublicSocialFriends wf
                       WHERE wf.SocialId = s.Id AND wf.Status = 'waitlist' AND wf.HoldExpiresAt IS NULL
                   ) AS WaitlistCount,
                   (
                       SELECT COUNT(*)
                       FROM (
                           SELECT c.Id, ROW_NUMBER() OVER (ORDER BY c.CourtNumber) AS CourtRank
                           FROM Courts c
                           WHERE c.VenueId = s.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
                       ) ranked
                       WHERE (s.MaxCourts IS NULL OR ranked.CourtRank <= s.MaxCourts)
                         AND EXISTS (
                             SELECT 1
                             FROM CourtSessions cs
                             JOIN Bookings b ON b.CourtSessionId = cs.Id
                             WHERE cs.CourtId = ranked.Id AND cs.IsDeleted = 0
                               AND cs.StartTime < s.EndTime AND cs.EndTime > s.StartTime
                               AND b.IsDeleted = 0
                               AND b.Status NOT IN ('cancelled', 'expired')
                               AND NOT (
                                   b.Status = 'pending'
                                   AND b.HoldExpiresAt IS NOT NULL
                                   AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
                               )
                         )
                   ) AS BlockedCourts
            FROM PublicSocials s
            LEFT JOIN PublicSocialRegistrations r ON r.SocialId = s.Id AND r.Status = 'confirmed'
            WHERE s.VenueId = @VenueId AND s.IsDeleted = 0
              AND s.StartTime > UTC_TIMESTAMP(6)
            GROUP BY s.Id, s.VenueId, s.StartTime, s.EndTime, s.Price, s.PlayersPerCourt, s.MaxCourts, s.RepeatWeekly
            ORDER BY s.StartTime
            """,
            new { VenueId = venueId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<SocialMineRow[]> ListMySocialStatesAsync(Guid userId, IReadOnlyCollection<Guid> socialIds, CancellationToken cancellationToken)
    {
        if (socialIds.Count == 0)
        {
            return [];
        }

        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<SocialMineRow>(new CommandDefinition(
            """
            SELECT SocialId, Status
            FROM PublicSocialRegistrations
            WHERE UserId = @UserId AND SocialId IN @SocialIds
              AND (
                  Status = 'confirmed'
                  OR (Status = 'waitlist' AND HoldExpiresAt IS NULL)
                  OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
              )
            """,
            new { UserId = userId, SocialIds = socialIds },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<SocialCheckoutHold> BeginPublicSocialCheckoutAsync(
        Guid venueId,
        Guid socialId,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var social = await connection.QuerySingleOrDefaultAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts
            FROM PublicSocials
            WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = socialId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (social is null)
        {
            return SocialCheckoutHold.Fail("That drop-in social was not found.", StatusCodes.Status404NotFound);
        }

        if (social.StartTime <= DateTime.UtcNow)
        {
            return SocialCheckoutHold.Fail("This drop-in social has already started.", StatusCodes.Status409Conflict);
        }

        var account = await connection.QuerySingleOrDefaultAsync<SocialAccountRow>(new CommandDefinition(
            """
            SELECT u.Email, u.StripeCustomerId, u.RewardPoints, v.PointsPerDollar, v.TimeZone
            FROM Users u
            JOIN Venues v ON v.Id = @VenueId
            WHERE u.Id = @Id AND u.IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = userId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (account is null)
        {
            return SocialCheckoutHold.Fail("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var onWaitlist = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*)
            FROM PublicSocialRegistrations
            WHERE SocialId = @SocialId AND UserId = @UserId AND Status = 'waitlist'
              AND (HoldExpiresAt IS NULL OR HoldExpiresAt > UTC_TIMESTAMP(6))
            """,
            new { SocialId = socialId, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        if (onWaitlist > 0)
        {
            return SocialCheckoutHold.Fail("You are already on the waitlist for this social.", StatusCodes.Status409Conflict);
        }

        var existing = await connection.QuerySingleOrDefaultAsync<SocialHoldRow>(new CommandDefinition(
            """
            SELECT r.Id, r.Status, r.Amount, r.SubtotalAmount, r.DiscountAmount, r.PointsRedeemed, r.PointsValue,
                   r.PromotionCodeId, c.CourtName, c.CourtNumber,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM PublicSocialPayments p
                       WHERE p.RegistrationId = r.Id AND p.FriendGroupId IS NULL AND p.Status IN ('pending', 'succeeded')
                       ORDER BY p.CreatedAt DESC
                       LIMIT 1
                   ) AS StripePaymentIntentId
            FROM PublicSocialRegistrations r
            JOIN Courts c ON c.Id = r.CourtId
            WHERE r.SocialId = @SocialId AND r.UserId = @UserId
              AND (
                  r.Status = 'confirmed'
                  OR (r.Status = 'pending' AND r.HoldExpiresAt > UTC_TIMESTAMP(6))
              )
            FOR UPDATE
            """,
            new { SocialId = socialId, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        if (existing is { Status: "confirmed" })
        {
            await tx.CommitAsync(cancellationToken);
            return new SocialCheckoutHold
            {
                RegistrationId = existing.Id,
                Status = existing.Status,
                ExistingIntentId = existing.StripePaymentIntentId,
                Amount = existing.Amount,
                Subtotal = existing.SubtotalAmount,
                DiscountAmount = existing.DiscountAmount,
                PointsRedeemed = existing.PointsRedeemed,
                PointsValue = existing.PointsValue,
                Currency = currency,
                Email = account.Email,
                StripeCustomerId = account.StripeCustomerId,
                CourtName = existing.CourtName,
                CourtNumber = existing.CourtNumber,
                AlreadyJoined = true,
                NeedsPayment = false,
            };
        }

        var price = decimal.Round(social.Price, 2, MidpointRounding.AwayFromZero);
        if (price <= 0)
        {
            return SocialCheckoutHold.Fail("This drop-in social does not have a session price yet.", StatusCodes.Status400BadRequest);
        }

        var (promoId, discount, promoError) = await LockSocialPromotionAsync(connection, tx, venueId, price, promotionCode, cancellationToken);
        if (promoError is not null)
        {
            return SocialCheckoutHold.Fail(promoError, StatusCodes.Status400BadRequest);
        }

        var spentAlready = existing?.PointsRedeemed ?? 0;
        var (points, value, cash, quoteError) = PaymentRepository.Quote(requestedPoints, account.RewardPoints + spentAlready, account.PointsPerDollar, price - discount);
        if (quoteError is not null)
        {
            return SocialCheckoutHold.Fail(quoteError, StatusCodes.Status400BadRequest);
        }

        var pointDelta = points - spentAlready;
        if (pointDelta > 0)
        {
            var spent = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints - @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND RewardPoints >= @Points
                """,
                new { Id = userId, Points = pointDelta },
                tx,
                cancellationToken: cancellationToken));
            if (spent != 1)
            {
                return SocialCheckoutHold.Fail("You do not have enough reward points.", StatusCodes.Status409Conflict);
            }
        }
        else if (pointDelta < 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = userId, Points = -pointDelta },
                tx,
                cancellationToken: cancellationToken));
        }

        if (existing?.PromotionCodeId != promoId)
        {
            if (existing?.PromotionCodeId is not null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE PromotionCodes SET UsedCount = GREATEST(UsedCount - 1, 0), UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = existing.PromotionCodeId },
                    tx,
                    cancellationToken: cancellationToken));
            }

            if (promoId is not null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE PromotionCodes SET UsedCount = UsedCount + 1, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = promoId },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        var incentivePoints = await SocialIncentivePointsAsync(connection, tx, venueId, account.TimeZone, social.StartTime, cancellationToken);
        var confirmedNow = cash <= 0;

        if (existing is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Status = @Status,
                    Amount = @Cash,
                    SubtotalAmount = @Price,
                    DiscountAmount = @Discount,
                    PointsRedeemed = @Points,
                    PointsValue = @PointsValue,
                    PromotionCodeId = @PromotionCodeId,
                    IncentivePoints = @IncentivePoints,
                    HoldExpiresAt = CASE WHEN @Confirmed = 1 THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) END,
                    ConfirmedAt = CASE WHEN @Confirmed = 1 THEN UTC_TIMESTAMP(6) ELSE NULL END
                WHERE Id = @Id AND Status = 'pending'
                """,
                new
                {
                    Id = existing.Id,
                    Status = confirmedNow ? "confirmed" : "pending",
                    Cash = cash,
                    Price = price,
                    Discount = discount,
                    Points = points,
                    PointsValue = value,
                    PromotionCodeId = promoId,
                    IncentivePoints = incentivePoints,
                    Confirmed = confirmedNow ? 1 : 0,
                },
                tx,
                cancellationToken: cancellationToken));
            await tx.CommitAsync(cancellationToken);
            return new SocialCheckoutHold
            {
                RegistrationId = existing.Id,
                Status = confirmedNow ? "confirmed" : "pending",
                ExistingIntentId = existing.StripePaymentIntentId,
                Amount = cash,
                Subtotal = price,
                DiscountAmount = discount,
                PointsRedeemed = points,
                PointsValue = value,
                IncentivePoints = incentivePoints,
                Currency = currency,
                Email = account.Email,
                StripeCustomerId = account.StripeCustomerId,
                CourtName = existing.CourtName,
                CourtNumber = existing.CourtNumber,
                NeedsPayment = !confirmedNow,
                Requoted = !string.IsNullOrWhiteSpace(existing.StripePaymentIntentId),
            };
        }

        var counts = (await connection.QueryAsync<SocialCourtCountRow>(new CommandDefinition(
            """
            SELECT CourtId, COUNT(*) AS Players
            FROM (
                SELECT CourtId
                FROM PublicSocialRegistrations
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
                UNION ALL
                SELECT CourtId
                FROM PublicSocialFriends
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
            ) occupied
            GROUP BY CourtId
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken))).ToDictionary(row => row.CourtId, row => row.Players);
        var courts = (await connection.QueryAsync<PublicCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber, SurfaceType, ImageUrl, Description
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            FOR UPDATE
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        await BlockPrivateCourtsAsync(connection, tx, venueId, social.StartTime, social.EndTime, counts, social.PlayersPerCourt, cancellationToken);
        var court = NextSocialCourt(courts, counts, social.PlayersPerCourt, social.MaxCourts);
        if (court is null)
        {
            return SocialCheckoutHold.Fail("This drop-in social is full.", StatusCodes.Status409Conflict);
        }

        var registrationId = Guid.NewGuid();
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PublicSocialRegistrations
                    (Id, SocialId, VenueId, UserId, CourtId, Status, Amount, SubtotalAmount, DiscountAmount,
                     PointsRedeemed, PointsValue, PromotionCodeId, IncentivePoints, HoldExpiresAt, ConfirmedAt, CreatedAt)
                VALUES
                    (@Id, @SocialId, @VenueId, @UserId, @CourtId, @Status, @Cash, @Price, @Discount,
                     @Points, @PointsValue, @PromotionCodeId, @IncentivePoints,
                     CASE WHEN @Confirmed = 1 THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) END,
                     CASE WHEN @Confirmed = 1 THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = registrationId,
                    SocialId = socialId,
                    VenueId = venueId,
                    UserId = userId,
                    CourtId = court.Id,
                    Status = confirmedNow ? "confirmed" : "pending",
                    Cash = cash,
                    Price = price,
                    Discount = discount,
                    Points = points,
                    PointsValue = value,
                    PromotionCodeId = promoId,
                    IncentivePoints = incentivePoints,
                    Confirmed = confirmedNow ? 1 : 0,
                },
                tx,
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return SocialCheckoutHold.Fail("You already have a place in this drop-in social.", StatusCodes.Status409Conflict);
        }

        await tx.CommitAsync(cancellationToken);
        return new SocialCheckoutHold
        {
            RegistrationId = registrationId,
            Status = confirmedNow ? "confirmed" : "pending",
            Amount = cash,
            Subtotal = price,
            DiscountAmount = discount,
            PointsRedeemed = points,
            PointsValue = value,
            IncentivePoints = incentivePoints,
            Currency = currency,
            Email = account.Email,
            StripeCustomerId = account.StripeCustomerId,
            CourtName = court.CourtName,
            CourtNumber = court.CourtNumber,
            NeedsPayment = !confirmedNow,
        };
    }

    public async Task<SocialCheckoutHold> BeginSocialWaitlistCheckoutAsync(
        Guid venueId,
        Guid socialId,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var social = await connection.QuerySingleOrDefaultAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts
            FROM PublicSocials
            WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = socialId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (social is null)
        {
            return SocialCheckoutHold.Fail("That drop-in social was not found.", StatusCodes.Status404NotFound);
        }

        if (social.StartTime <= DateTime.UtcNow)
        {
            return SocialCheckoutHold.Fail("This drop-in social has already started.", StatusCodes.Status409Conflict);
        }

        var account = await connection.QuerySingleOrDefaultAsync<SocialAccountRow>(new CommandDefinition(
            """
            SELECT u.Email, u.StripeCustomerId, u.RewardPoints, v.PointsPerDollar, v.TimeZone
            FROM Users u
            JOIN Venues v ON v.Id = @VenueId
            WHERE u.Id = @Id AND u.IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = userId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (account is null)
        {
            return SocialCheckoutHold.Fail("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var existing = await connection.QuerySingleOrDefaultAsync<SocialHoldRow>(new CommandDefinition(
            """
            SELECT r.Id, r.Status, r.Amount, r.SubtotalAmount, r.DiscountAmount, r.PointsRedeemed, r.PointsValue,
                   r.PromotionCodeId, r.HoldExpiresAt,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM PublicSocialPayments p
                       WHERE p.RegistrationId = r.Id AND p.FriendGroupId IS NULL AND p.Status IN ('pending', 'succeeded')
                       ORDER BY p.CreatedAt DESC
                       LIMIT 1
                   ) AS StripePaymentIntentId
            FROM PublicSocialRegistrations r
            WHERE r.SocialId = @SocialId AND r.UserId = @UserId
              AND (
                  r.Status = 'confirmed'
                  OR (r.Status = 'pending' AND r.HoldExpiresAt > UTC_TIMESTAMP(6))
                  OR (r.Status = 'waitlist' AND (r.HoldExpiresAt IS NULL OR r.HoldExpiresAt > UTC_TIMESTAMP(6)))
              )
            FOR UPDATE
            """,
            new { SocialId = socialId, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        if (existing is { Status: "confirmed" })
        {
            return SocialCheckoutHold.Fail("You already have a place in this drop-in social.", StatusCodes.Status409Conflict);
        }

        if (existing is { Status: "pending" })
        {
            return SocialCheckoutHold.Fail("Finish the open registration payment first, or let that hold expire.", StatusCodes.Status409Conflict);
        }

        if (existing is { Status: "waitlist", HoldExpiresAt: null })
        {
            await tx.CommitAsync(cancellationToken);
            return new SocialCheckoutHold
            {
                RegistrationId = existing.Id,
                Status = "waitlist",
                ExistingIntentId = existing.StripePaymentIntentId,
                Amount = existing.Amount,
                Subtotal = existing.SubtotalAmount,
                DiscountAmount = existing.DiscountAmount,
                PointsRedeemed = existing.PointsRedeemed,
                PointsValue = existing.PointsValue,
                Currency = currency,
                Email = account.Email,
                StripeCustomerId = account.StripeCustomerId,
                AlreadyJoined = true,
                NeedsPayment = false,
                Waitlist = true,
            };
        }

        var counts = (await connection.QueryAsync<SocialCourtCountRow>(new CommandDefinition(
            """
            SELECT CourtId, COUNT(*) AS Players
            FROM (
                SELECT CourtId
                FROM PublicSocialRegistrations
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
                UNION ALL
                SELECT CourtId
                FROM PublicSocialFriends
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
            ) occupied
            GROUP BY CourtId
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken))).ToDictionary(row => row.CourtId, row => row.Players);
        var courts = (await connection.QueryAsync<PublicCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber, SurfaceType, ImageUrl, Description
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            FOR UPDATE
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        await BlockPrivateCourtsAsync(connection, tx, venueId, social.StartTime, social.EndTime, counts, social.PlayersPerCourt, cancellationToken);
        if (OpenSocialPlaces(courts, counts, social.PlayersPerCourt, social.MaxCourts) > 0)
        {
            return SocialCheckoutHold.Fail(
                existing is null
                    ? "A place is still open. Register instead."
                    : "A place opened. Cancel this waitlist hold from My bookings, then register.",
                StatusCodes.Status409Conflict);
        }

        var price = decimal.Round(social.Price, 2, MidpointRounding.AwayFromZero);
        if (price <= 0)
        {
            return SocialCheckoutHold.Fail("This drop-in social does not have a session price yet.", StatusCodes.Status400BadRequest);
        }

        var (promoId, discount, promoError) = await LockSocialPromotionAsync(connection, tx, venueId, price, promotionCode, cancellationToken);
        if (promoError is not null)
        {
            return SocialCheckoutHold.Fail(promoError, StatusCodes.Status400BadRequest);
        }

        var spentAlready = existing?.PointsRedeemed ?? 0;
        var (points, value, cash, quoteError) = PaymentRepository.Quote(requestedPoints, account.RewardPoints + spentAlready, account.PointsPerDollar, price - discount);
        if (quoteError is not null)
        {
            return SocialCheckoutHold.Fail(quoteError, StatusCodes.Status400BadRequest);
        }

        var pointDelta = points - spentAlready;
        if (pointDelta > 0)
        {
            var spent = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints - @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND RewardPoints >= @Points
                """,
                new { Id = userId, Points = pointDelta },
                tx,
                cancellationToken: cancellationToken));
            if (spent != 1)
            {
                return SocialCheckoutHold.Fail("You do not have enough reward points.", StatusCodes.Status409Conflict);
            }
        }
        else if (pointDelta < 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = userId, Points = -pointDelta },
                tx,
                cancellationToken: cancellationToken));
        }

        if (existing?.PromotionCodeId != promoId)
        {
            if (existing?.PromotionCodeId is not null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE PromotionCodes SET UsedCount = GREATEST(UsedCount - 1, 0), UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = existing.PromotionCodeId },
                    tx,
                    cancellationToken: cancellationToken));
            }

            if (promoId is not null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE PromotionCodes SET UsedCount = UsedCount + 1, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = promoId },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        var incentivePoints = await SocialIncentivePointsAsync(connection, tx, venueId, account.TimeZone, social.StartTime, cancellationToken);
        var paidNow = cash <= 0;
        if (existing is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Amount = @Cash,
                    SubtotalAmount = @Price,
                    DiscountAmount = @Discount,
                    PointsRedeemed = @Points,
                    PointsValue = @PointsValue,
                    PromotionCodeId = @PromotionCodeId,
                    IncentivePoints = @IncentivePoints,
                    HoldExpiresAt = CASE WHEN @Paid = 1 THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) END
                WHERE Id = @Id AND Status = 'waitlist'
                """,
                new
                {
                    Id = existing.Id,
                    Cash = cash,
                    Price = price,
                    Discount = discount,
                    Points = points,
                    PointsValue = value,
                    PromotionCodeId = promoId,
                    IncentivePoints = incentivePoints,
                    Paid = paidNow ? 1 : 0,
                },
                tx,
                cancellationToken: cancellationToken));
            await tx.CommitAsync(cancellationToken);
            return new SocialCheckoutHold
            {
                RegistrationId = existing.Id,
                Status = "waitlist",
                ExistingIntentId = existing.StripePaymentIntentId,
                Amount = cash,
                Subtotal = price,
                DiscountAmount = discount,
                PointsRedeemed = points,
                PointsValue = value,
                IncentivePoints = incentivePoints,
                Currency = currency,
                Email = account.Email,
                StripeCustomerId = account.StripeCustomerId,
                NeedsPayment = !paidNow,
                Requoted = !string.IsNullOrWhiteSpace(existing.StripePaymentIntentId),
                Waitlist = true,
            };
        }

        var registrationId = Guid.NewGuid();
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PublicSocialRegistrations
                    (Id, SocialId, VenueId, UserId, CourtId, Status, Amount, SubtotalAmount, DiscountAmount,
                     PointsRedeemed, PointsValue, PromotionCodeId, IncentivePoints, HoldExpiresAt, CreatedAt)
                VALUES
                    (@Id, @SocialId, @VenueId, @UserId, NULL, 'waitlist', @Cash, @Price, @Discount,
                     @Points, @PointsValue, @PromotionCodeId, @IncentivePoints,
                     CASE WHEN @Paid = 1 THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = registrationId,
                    SocialId = socialId,
                    VenueId = venueId,
                    UserId = userId,
                    Cash = cash,
                    Price = price,
                    Discount = discount,
                    Points = points,
                    PointsValue = value,
                    PromotionCodeId = promoId,
                    IncentivePoints = incentivePoints,
                    Paid = paidNow ? 1 : 0,
                },
                tx,
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return SocialCheckoutHold.Fail("You already have a place in this drop-in social.", StatusCodes.Status409Conflict);
        }

        await tx.CommitAsync(cancellationToken);
        return new SocialCheckoutHold
        {
            RegistrationId = registrationId,
            Status = "waitlist",
            Amount = cash,
            Subtotal = price,
            DiscountAmount = discount,
            PointsRedeemed = points,
            PointsValue = value,
            IncentivePoints = incentivePoints,
            Currency = currency,
            Email = account.Email,
            StripeCustomerId = account.StripeCustomerId,
            NeedsPayment = !paidNow,
            Waitlist = true,
        };
    }

    public async Task<SocialCheckoutHold> BeginPublicSocialBatchCheckoutAsync(
        Guid venueId,
        IReadOnlyCollection<Guid> socialIds,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        CancellationToken cancellationToken)
    {
        var ids = socialIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        if (ids.Length == 0)
        {
            return SocialCheckoutHold.Fail("Choose a drop-in time.", StatusCodes.Status400BadRequest);
        }

        if (ids.Length > 8)
        {
            return SocialCheckoutHold.Fail("Choose up to 8 drop-in times.", StatusCodes.Status400BadRequest);
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var socials = (await connection.QueryAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts
            FROM PublicSocials
            WHERE VenueId = @VenueId AND IsDeleted = 0 AND Id IN @Ids
            ORDER BY StartTime
            FOR UPDATE
            """,
            new { VenueId = venueId, Ids = ids },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (socials.Length != ids.Length)
        {
            return SocialCheckoutHold.Fail("One of those drop-in times was not found.", StatusCodes.Status404NotFound);
        }

        if (socials.Any(social => social.StartTime <= DateTime.UtcNow))
        {
            return SocialCheckoutHold.Fail("One of these drop-in times has already started.", StatusCodes.Status409Conflict);
        }

        if (socials.Any(social => social.Price <= 0))
        {
            return SocialCheckoutHold.Fail("One of these drop-in times does not have a session price yet.", StatusCodes.Status400BadRequest);
        }

        var account = await connection.QuerySingleOrDefaultAsync<SocialAccountRow>(new CommandDefinition(
            """
            SELECT u.Email, u.StripeCustomerId, u.RewardPoints, v.PointsPerDollar, v.TimeZone
            FROM Users u
            JOIN Venues v ON v.Id = @VenueId
            WHERE u.Id = @Id AND u.IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = userId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (account is null)
        {
            return SocialCheckoutHold.Fail("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var confirmed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM PublicSocialRegistrations
            WHERE UserId = @UserId AND SocialId IN @Ids AND Status = 'confirmed'
            """,
            new { UserId = userId, Ids = ids },
            tx,
            cancellationToken: cancellationToken));
        if (confirmed > 0)
        {
            return SocialCheckoutHold.Fail("You are already registered for one of these times.", StatusCodes.Status409Conflict);
        }

        var stale = (await connection.QueryAsync<StaleSocialHoldRow>(new CommandDefinition(
            """
            SELECT r.Id, r.SocialId, r.PointsRedeemed, r.PromotionCodeId, r.CheckoutGroupId,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM PublicSocialPayments p
                       WHERE p.RegistrationId = r.Id AND p.FriendGroupId IS NULL AND p.Status = 'pending'
                       ORDER BY p.CreatedAt DESC
                       LIMIT 1
                   ) AS StripePaymentIntentId
            FROM PublicSocialRegistrations r
            WHERE r.UserId = @UserId AND r.Status = 'pending' AND r.HoldExpiresAt > UTC_TIMESTAMP(6)
              AND (
                  r.SocialId IN @Ids
                  OR r.CheckoutGroupId IN (
                      SELECT g.CheckoutGroupId
                      FROM (
                          SELECT CheckoutGroupId
                          FROM PublicSocialRegistrations
                          WHERE UserId = @UserId AND Status = 'pending' AND SocialId IN @Ids AND CheckoutGroupId IS NOT NULL
                      ) g
                  )
              )
            FOR UPDATE
            """,
            new { UserId = userId, Ids = ids },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in stale)
        {
            await RestoreSocialPointsAsync(connection, tx, userId, row.PointsRedeemed, cancellationToken);
            if (row.PromotionCodeId is not null)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    "UPDATE PromotionCodes SET UsedCount = GREATEST(UsedCount - 1, 0), UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                    new { Id = row.PromotionCodeId },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        if (stale.Length > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Status = 'pending' AND FriendGroupId IS NULL AND RegistrationId IN @Ids
                """,
                new { Ids = stale.Select(row => row.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
                WHERE Id IN @Ids AND Status = 'pending'
                """,
                new { Ids = stale.Select(row => row.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
        }

        var subtotal = socials.Sum(social => decimal.Round(social.Price, 2, MidpointRounding.AwayFromZero));
        var (promoId, discount, promoError) = await LockSocialPromotionAsync(connection, tx, venueId, subtotal, promotionCode, cancellationToken);
        if (promoError is not null)
        {
            return SocialCheckoutHold.Fail(promoError, StatusCodes.Status400BadRequest);
        }

        var payable = subtotal - discount;
        var (points, value, cash, quoteError) = PaymentRepository.Quote(requestedPoints, account.RewardPoints + stale.Sum(row => row.PointsRedeemed), account.PointsPerDollar, payable);
        if (quoteError is not null)
        {
            return SocialCheckoutHold.Fail(quoteError, StatusCodes.Status400BadRequest);
        }

        if (points > 0)
        {
            var spent = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints - @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND RewardPoints >= @Points
                """,
                new { Id = userId, Points = points },
                tx,
                cancellationToken: cancellationToken));
            if (spent != 1)
            {
                return SocialCheckoutHold.Fail("You do not have enough reward points.", StatusCodes.Status409Conflict);
            }
        }

        if (promoId is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE PromotionCodes SET UsedCount = UsedCount + 1, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                new { Id = promoId },
                tx,
                cancellationToken: cancellationToken));
        }

        var prices = socials.Select(social => decimal.Round(social.Price, 2, MidpointRounding.AwayFromZero)).ToArray();
        var discounts = SplitMoney(prices, discount);
        var payables = prices.Select((price, index) => price - discounts[index]).ToArray();
        var values = SplitMoney(payables, value);
        var cashes = payables.Select((amount, index) => amount - values[index]).ToArray();
        var pointShares = SplitInt(payables, points);
        var confirmedNow = cash <= 0;
        var groupId = Guid.NewGuid();
        Guid primaryId = Guid.Empty;
        string courtName = "";
        var courtNumber = 0;
        var incentiveTotal = 0;
        var courts = (await connection.QueryAsync<PublicCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber, SurfaceType, ImageUrl, Description
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            FOR UPDATE
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();

        for (var index = 0; index < socials.Length; index++)
        {
            var social = socials[index];
            var counts = (await connection.QueryAsync<SocialCourtCountRow>(new CommandDefinition(
                """
                SELECT CourtId, COUNT(*) AS Players
                FROM (
                    SELECT CourtId
                    FROM PublicSocialRegistrations
                    WHERE SocialId = @SocialId
                      AND (
                          Status = 'confirmed'
                          OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                      )
                    UNION ALL
                    SELECT CourtId
                    FROM PublicSocialFriends
                    WHERE SocialId = @SocialId
                      AND (
                          Status = 'confirmed'
                          OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                      )
                ) occupied
                GROUP BY CourtId
                """,
                new { SocialId = social.Id },
                tx,
                cancellationToken: cancellationToken))).ToDictionary(row => row.CourtId, row => row.Players);
            await BlockPrivateCourtsAsync(connection, tx, venueId, social.StartTime, social.EndTime, counts, social.PlayersPerCourt, cancellationToken);
            var court = NextSocialCourt(courts, counts, social.PlayersPerCourt, social.MaxCourts);
            if (court is null)
            {
                return SocialCheckoutHold.Fail("One of these drop-in times is full.", StatusCodes.Status409Conflict);
            }

            var registrationId = Guid.NewGuid();
            var incentivePoints = await SocialIncentivePointsAsync(connection, tx, venueId, account.TimeZone, social.StartTime, cancellationToken);
            incentiveTotal += incentivePoints;
            if (primaryId == Guid.Empty)
            {
                primaryId = registrationId;
                courtName = court.CourtName;
                courtNumber = court.CourtNumber;
            }

            try
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO PublicSocialRegistrations
                        (Id, SocialId, VenueId, UserId, CourtId, Status, Amount, SubtotalAmount, DiscountAmount,
                         PointsRedeemed, PointsValue, PromotionCodeId, CheckoutGroupId, IncentivePoints, HoldExpiresAt, ConfirmedAt, CreatedAt)
                    VALUES
                        (@Id, @SocialId, @VenueId, @UserId, @CourtId, @Status, @Cash, @Price, @Discount,
                         @Points, @PointsValue, @PromotionCodeId, @GroupId, @IncentivePoints,
                         CASE WHEN @Confirmed = 1 THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) END,
                         CASE WHEN @Confirmed = 1 THEN UTC_TIMESTAMP(6) ELSE NULL END,
                         UTC_TIMESTAMP(6))
                    """,
                    new
                    {
                        Id = registrationId,
                        SocialId = social.Id,
                        VenueId = venueId,
                        UserId = userId,
                        CourtId = court.Id,
                        Status = confirmedNow ? "confirmed" : "pending",
                        Cash = cashes[index],
                        Price = prices[index],
                        Discount = discounts[index],
                        Points = pointShares[index],
                        PointsValue = values[index],
                        PromotionCodeId = promoId,
                        GroupId = groupId,
                        IncentivePoints = incentivePoints,
                        Confirmed = confirmedNow ? 1 : 0,
                    },
                    tx,
                    cancellationToken: cancellationToken));
            }
            catch (MySqlException exception) when (exception.Number == 1062)
            {
                return SocialCheckoutHold.Fail("You already have a place in one of these drop-in times.", StatusCodes.Status409Conflict);
            }
        }

        await tx.CommitAsync(cancellationToken);
        return new SocialCheckoutHold
        {
            RegistrationId = primaryId,
            CheckoutGroupId = groupId,
            Status = confirmedNow ? "confirmed" : "pending",
            ExistingIntentId = stale.Select(row => row.StripePaymentIntentId).FirstOrDefault(id => !string.IsNullOrWhiteSpace(id)),
            Amount = cash,
            Subtotal = subtotal,
            DiscountAmount = discount,
            PointsRedeemed = points,
            PointsValue = value,
            IncentivePoints = incentiveTotal,
            Currency = currency,
            Email = account.Email,
            StripeCustomerId = account.StripeCustomerId,
            CourtName = courtName,
            CourtNumber = courtNumber,
            NeedsPayment = !confirmedNow,
            Requoted = stale.Any(row => !string.IsNullOrWhiteSpace(row.StripePaymentIntentId)),
        };
    }

    public async Task<SocialCheckoutHold> BeginFriendCheckoutAsync(
        Guid venueId,
        Guid socialId,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        IReadOnlyList<string> names,
        CancellationToken cancellationToken)
    {
        var cleaned = names.Select(name => name.Trim()).Where(name => name.Length > 0).ToArray();
        if (cleaned.Length == 0)
        {
            return SocialCheckoutHold.Fail("Enter at least one friend's name.", StatusCodes.Status400BadRequest);
        }

        if (cleaned.Any(name => name.Length > 80))
        {
            return SocialCheckoutHold.Fail("A friend's name can be at most 80 characters.", StatusCodes.Status400BadRequest);
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var social = await connection.QuerySingleOrDefaultAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price, PlayersPerCourt, MaxCourts
            FROM PublicSocials
            WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = socialId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (social is null)
        {
            return SocialCheckoutHold.Fail("That drop-in social was not found.", StatusCodes.Status404NotFound);
        }

        if (social.StartTime <= DateTime.UtcNow)
        {
            return SocialCheckoutHold.Fail("This drop-in social has already started.", StatusCodes.Status409Conflict);
        }

        var price = decimal.Round(social.Price, 2, MidpointRounding.AwayFromZero);
        if (price <= 0)
        {
            return SocialCheckoutHold.Fail("This drop-in social does not have a session price yet.", StatusCodes.Status400BadRequest);
        }

        var account = await connection.QuerySingleOrDefaultAsync<SocialAccountRow>(new CommandDefinition(
            """
            SELECT u.Email, u.StripeCustomerId, u.RewardPoints, v.PointsPerDollar, v.TimeZone
            FROM Users u
            JOIN Venues v ON v.Id = @VenueId
            WHERE u.Id = @Id AND u.IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = userId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (account is null)
        {
            return SocialCheckoutHold.Fail("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var registrationId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            """
            SELECT Id FROM PublicSocialRegistrations
            WHERE SocialId = @SocialId AND UserId = @UserId AND Status = 'confirmed'
            FOR UPDATE
            """,
            new { SocialId = socialId, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        if (registrationId is null)
        {
            return SocialCheckoutHold.Fail("Register for this drop-in social before adding friends.", StatusCodes.Status409Conflict);
        }

        var replacedIntent = await ReleasePendingFriendsAsync(connection, tx, registrationId.Value, cancellationToken);
        var subtotal = decimal.Round(price * cleaned.Length, 2, MidpointRounding.AwayFromZero);
        var (promoId, discount, promoError) = await LockSocialPromotionAsync(connection, tx, venueId, subtotal, promotionCode, cancellationToken);
        if (promoError is not null)
        {
            return SocialCheckoutHold.Fail(promoError, StatusCodes.Status400BadRequest);
        }

        var payable = subtotal - discount;
        var (points, value, cash, quoteError) = PaymentRepository.Quote(requestedPoints, account.RewardPoints, account.PointsPerDollar, payable);
        if (quoteError is not null)
        {
            return SocialCheckoutHold.Fail(quoteError, StatusCodes.Status400BadRequest);
        }

        if (points > 0)
        {
            var spent = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints - @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND RewardPoints >= @Points
                """,
                new { Id = userId, Points = points },
                tx,
                cancellationToken: cancellationToken));
            if (spent != 1)
            {
                return SocialCheckoutHold.Fail("You do not have enough reward points.", StatusCodes.Status409Conflict);
            }
        }

        if (promoId is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE PromotionCodes SET UsedCount = UsedCount + 1, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                new { Id = promoId },
                tx,
                cancellationToken: cancellationToken));
        }

        var courts = (await connection.QueryAsync<PublicCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber, SurfaceType, ImageUrl, Description
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            FOR UPDATE
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        var counts = (await connection.QueryAsync<SocialCourtCountRow>(new CommandDefinition(
            """
            SELECT CourtId, COUNT(*) AS Players
            FROM (
                SELECT CourtId
                FROM PublicSocialRegistrations
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
                UNION ALL
                SELECT CourtId
                FROM PublicSocialFriends
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
            ) occupied
            GROUP BY CourtId
            """,
            new { SocialId = socialId },
            tx,
            cancellationToken: cancellationToken))).ToDictionary(row => row.CourtId, row => row.Players);
        await BlockPrivateCourtsAsync(connection, tx, venueId, social.StartTime, social.EndTime, counts, social.PlayersPerCourt, cancellationToken);
        var open = OpenSocialPlaces(courts, counts, social.PlayersPerCourt, social.MaxCourts);
        var onWaitlist = open == 0;
        if (!onWaitlist && cleaned.Length > open)
        {
            var left = open == 1 ? "1 place is" : $"{open} places are";
            return SocialCheckoutHold.Fail($"Only {left} left.", StatusCodes.Status409Conflict);
        }

        var prices = Enumerable.Repeat(price, cleaned.Length).ToArray();
        var discounts = SplitMoney(prices, discount);
        var payables = prices.Select((amount, index) => amount - discounts[index]).ToArray();
        var values = SplitMoney(payables, value);
        var cashes = payables.Select((amount, index) => amount - values[index]).ToArray();
        var pointShares = SplitInt(payables, points);
        var confirmedNow = !onWaitlist && cash <= 0;
        var settledNow = cash <= 0;
        var groupId = Guid.NewGuid();
        var incentivePoints = await SocialIncentivePointsAsync(connection, tx, venueId, account.TimeZone, social.StartTime, cancellationToken);
        for (var index = 0; index < cleaned.Length; index++)
        {
            Guid? courtId = null;
            if (!onWaitlist)
            {
                var court = NextSocialCourt(courts, counts, social.PlayersPerCourt, social.MaxCourts);
                if (court is null)
                {
                    return SocialCheckoutHold.Fail("This drop-in social is full.", StatusCodes.Status409Conflict);
                }

                courtId = court.Id;
                counts[court.Id] = counts.GetValueOrDefault(court.Id) + 1;
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PublicSocialFriends
                    (Id, RegistrationId, SocialId, VenueId, CourtId, DisplayName, Status, Amount, SubtotalAmount,
                     DiscountAmount, PointsRedeemed, PointsValue, IncentivePoints, PromotionCodeId, CheckoutGroupId, HoldExpiresAt, ConfirmedAt, CreatedAt)
                VALUES
                    (@Id, @RegistrationId, @SocialId, @VenueId, @CourtId, @Name, @Status, @Cash, @Price,
                     @Discount, @Points, @PointsValue, @IncentivePoints, @PromotionCodeId, @GroupId,
                     CASE WHEN @Settled = 1 THEN NULL ELSE DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) END,
                     CASE WHEN @Confirmed = 1 THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    RegistrationId = registrationId,
                    SocialId = socialId,
                    VenueId = venueId,
                    CourtId = courtId,
                    Name = cleaned[index],
                    Status = onWaitlist ? "waitlist" : confirmedNow ? "confirmed" : "pending",
                    Cash = cashes[index],
                    Price = prices[index],
                    Discount = discounts[index],
                    Points = pointShares[index],
                    PointsValue = values[index],
                    IncentivePoints = incentivePoints,
                    PromotionCodeId = promoId,
                    GroupId = groupId,
                    Settled = settledNow ? 1 : 0,
                    Confirmed = confirmedNow ? 1 : 0,
                },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        return new SocialCheckoutHold
        {
            RegistrationId = registrationId.Value,
            CheckoutGroupId = groupId,
            Status = onWaitlist ? "waitlist" : confirmedNow ? "confirmed" : "pending",
            Waitlist = onWaitlist,
            ExistingIntentId = replacedIntent,
            Amount = cash,
            Subtotal = subtotal,
            DiscountAmount = discount,
            PointsRedeemed = points,
            PointsValue = value,
            Currency = currency,
            Email = account.Email,
            StripeCustomerId = account.StripeCustomerId,
            NeedsPayment = !settledNow,
            Requoted = !string.IsNullOrWhiteSpace(replacedIntent),
            FriendCount = cleaned.Length,
        };
    }

    public async Task ReleaseFriendGroupAsync(Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await ReleaseFriendRowsAsync(connection, tx, groupId, cancelPayment: true, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }

    public async Task AttachFriendPaymentAsync(
        Guid registrationId,
        Guid friendGroupId,
        Guid userId,
        string? customerId,
        string intentId,
        decimal amount,
        string currency,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(customerId))
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET StripeCustomerId = @CustomerId, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND (StripeCustomerId IS NULL OR StripeCustomerId = @CustomerId)
                """,
                new { Id = userId, CustomerId = customerId },
                tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO PublicSocialPayments
                (Id, RegistrationId, FriendGroupId, StripePaymentIntentId, Amount, Currency, Status, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @RegistrationId, @FriendGroupId, @IntentId, @Amount, @Currency, 'pending', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            """,
            new
            {
                Id = Guid.NewGuid(),
                RegistrationId = registrationId,
                FriendGroupId = friendGroupId,
                IntentId = intentId,
                Amount = amount,
                Currency = currency,
            },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<bool> FriendPaymentExistsAsync(string intentId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var count = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM PublicSocialPayments WHERE StripePaymentIntentId = @IntentId AND FriendGroupId IS NOT NULL",
            new { IntentId = intentId },
            cancellationToken: cancellationToken));
        return count > 0;
    }

    public async Task<bool> BindFriendPaymentIntentAsync(Guid friendGroupId, string intentId, CancellationToken cancellationToken)
    {
        if (await FriendPaymentExistsAsync(intentId, cancellationToken))
        {
            return true;
        }

        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET StripePaymentIntentId = @IntentId, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE FriendGroupId = @FriendGroupId
              AND Status = 'pending'
              AND StripePaymentIntentId <> @IntentId
            ORDER BY CreatedAt DESC
            LIMIT 1
            """,
            new { FriendGroupId = friendGroupId, IntentId = intentId },
            cancellationToken: cancellationToken));
        return await FriendPaymentExistsAsync(intentId, cancellationToken);
    }

    public async Task<SocialPaymentTransition?> MarkFriendSucceededAsync(string intentId, string? chargeId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<FriendPaymentStateRow>(new CommandDefinition(
            """
            SELECT p.Id AS PaymentId, p.Status AS PaymentStatus, p.Amount, p.FriendGroupId
            FROM PublicSocialPayments p
            WHERE p.StripePaymentIntentId = @IntentId AND p.FriendGroupId IS NOT NULL
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (row?.FriendGroupId is null)
        {
            return null;
        }

        if (row.PaymentStatus is "pending" or "failed")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'succeeded', StripeChargeId = @ChargeId, PaidAt = UTC_TIMESTAMP(6), UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = row.PaymentId, ChargeId = chargeId },
                tx,
                cancellationToken: cancellationToken));
        }

        var pending = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM PublicSocialFriends WHERE CheckoutGroupId = @GroupId AND Status = 'pending'",
            new { GroupId = row.FriendGroupId },
            tx,
            cancellationToken: cancellationToken));
        if (pending > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialFriends
                SET Status = 'confirmed', ConfirmedAt = UTC_TIMESTAMP(6), HoldExpiresAt = NULL
                WHERE CheckoutGroupId = @GroupId AND Status = 'pending'
                """,
                new { GroupId = row.FriendGroupId },
                tx,
                cancellationToken: cancellationToken));
            await tx.CommitAsync(cancellationToken);
            return new SocialPaymentTransition("confirmed", row.FriendGroupId.Value, 0, row.PaymentStatus);
        }

        var waiting = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM PublicSocialFriends WHERE CheckoutGroupId = @GroupId AND Status = 'waitlist'",
            new { GroupId = row.FriendGroupId },
            tx,
            cancellationToken: cancellationToken));
        if (waiting > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialFriends
                SET HoldExpiresAt = NULL
                WHERE CheckoutGroupId = @GroupId AND Status = 'waitlist'
                """,
                new { GroupId = row.FriendGroupId },
                tx,
                cancellationToken: cancellationToken));
            await tx.CommitAsync(cancellationToken);
            return new SocialPaymentTransition("waiting", row.FriendGroupId.Value, 0, row.PaymentStatus);
        }

        var active = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM PublicSocialFriends WHERE CheckoutGroupId = @GroupId AND Status = 'confirmed'",
            new { GroupId = row.FriendGroupId },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
        if (active == 0 && row.PaymentStatus is "pending" or "failed")
        {
            return new SocialPaymentTransition("refund", row.FriendGroupId.Value, row.Amount, row.PaymentStatus);
        }

        return new SocialPaymentTransition("already", row.FriendGroupId.Value, 0, row.PaymentStatus);
    }

    public async Task ExtendFriendHoldAsync(string intentId, DateTime untilUtc, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialFriends f
            JOIN PublicSocialPayments p ON p.FriendGroupId = f.CheckoutGroupId
            SET f.HoldExpiresAt = CASE
                    WHEN f.HoldExpiresAt IS NULL OR f.HoldExpiresAt < @Until THEN @Until
                    ELSE f.HoldExpiresAt
                END
            WHERE p.StripePaymentIntentId = @IntentId AND f.Status IN ('pending', 'waitlist')
            """,
            new { IntentId = intentId, Until = untilUtc },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> FailFriendPendingAsync(string intentId, string paymentStatus, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var groupId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            """
            SELECT FriendGroupId FROM PublicSocialPayments
            WHERE StripePaymentIntentId = @IntentId AND FriendGroupId IS NOT NULL AND Status = 'pending'
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (groupId is null)
        {
            return false;
        }

        await ReleaseFriendRowsAsync(connection, tx, groupId.Value, cancelPayment: false, cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET Status = @Status, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE StripePaymentIntentId = @IntentId AND Status = 'pending'
            """,
            new { IntentId = intentId, Status = paymentStatus },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<FriendCancelContext?> LoadFriendCancelAsync(Guid userId, Guid friendId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<FriendCancelContext>(new CommandDefinition(
            """
            SELECT f.Id, f.Status, f.Amount AS ShareAmount, f.PointsRedeemed, f.CheckoutGroupId, s.StartTime,
                   v.Currency, v.LateCancelFeePercent,
                   p.Id AS PaymentId, p.StripePaymentIntentId, p.Status AS PaymentStatus, p.Amount AS ChargedAmount
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            JOIN Venues v ON v.Id = f.VenueId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id FROM PublicSocialPayments p2
                WHERE p2.FriendGroupId = f.CheckoutGroupId
                ORDER BY p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE f.Id = @Id AND r.UserId = @UserId
            """,
            new { Id = friendId, UserId = userId },
            cancellationToken: cancellationToken));
    }

    public async Task<decimal> RefundedSocialAmountAsync(Guid paymentId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<decimal>(new CommandDefinition(
            """
            SELECT COALESCE(SUM(Amount), 0) FROM PublicSocialRefunds
            WHERE PaymentId = @PaymentId AND Status IN ('pending', 'succeeded')
            """,
            new { PaymentId = paymentId },
            cancellationToken: cancellationToken));
    }

    public async Task<int?> CompleteFriendCancelAsync(SocialCancelWrite write, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var held = await connection.QuerySingleOrDefaultAsync<FriendPointRow>(new CommandDefinition(
            """
            SELECT f.PointsRedeemed, f.CheckoutGroupId, f.Status, COALESCE(p.Amount, 0) AS ChargedAmount
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            LEFT JOIN PublicSocialPayments p ON p.Id = @PaymentId
            WHERE f.Id = @Id AND r.UserId = @UserId
              AND f.Status IN ('confirmed', 'waitlist')
              AND s.StartTime > UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            write,
            tx,
            cancellationToken: cancellationToken));
        if (held is null)
        {
            return null;
        }

        var restore = write.FeePercent <= 0
            ? held.PointsRedeemed
            : (int)Math.Floor(held.PointsRedeemed * (100m - write.FeePercent) / 100m);
        await RestoreSocialPointsAsync(connection, tx, write.UserId, restore, cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            SET f.Status = 'cancelled',
                f.CancelledAt = UTC_TIMESTAMP(6),
                f.CancelFeePercent = @FeePercent
            WHERE f.Id = @Id AND r.UserId = @UserId
              AND f.Status IN ('confirmed', 'waitlist')
              AND s.StartTime > UTC_TIMESTAMP(6)
            """,
            write,
            tx,
            cancellationToken: cancellationToken));
        if (changed != 1)
        {
            return null;
        }

        var paymentStatus = write.PaymentStatus;
        if (write.PaymentId is not null && paymentStatus == "refunded")
        {
            var others = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*) FROM PublicSocialFriends
                WHERE CheckoutGroupId = @GroupId AND Id <> @Id AND Status IN ('pending', 'confirmed', 'waitlist')
                """,
                new { GroupId = held.CheckoutGroupId, write.Id },
                tx,
                cancellationToken: cancellationToken));
            if (others > 0 || write.RefundAmount < held.ChargedAmount)
            {
                paymentStatus = "partially_refunded";
            }
        }

        if (write.PaymentId is not null && paymentStatus is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = @Status, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = write.PaymentId, Status = paymentStatus },
                tx,
                cancellationToken: cancellationToken));
        }

        if (!string.IsNullOrWhiteSpace(write.StripeRefundId) && write.PaymentId is not null && write.RefundAmount > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PublicSocialRefunds
                    (Id, PaymentId, StripeRefundId, Amount, Reason, Status, RequestedBy, ProcessedAt, CreatedAt)
                VALUES
                    (@Id, @PaymentId, @StripeRefundId, @Amount, 'Friend cancelled', @Status, @UserId,
                     CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    write.PaymentId,
                    write.StripeRefundId,
                    Amount = write.RefundAmount,
                    Status = write.RefundStatus,
                    write.UserId,
                },
                tx,
                cancellationToken: cancellationToken));
        }

        var friendSocialId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "SELECT SocialId FROM PublicSocialFriends WHERE Id = @Id",
            new { write.Id },
            tx,
            cancellationToken: cancellationToken));
        if (friendSocialId is Guid packedFriendSocialId)
        {
            if (held.Status == "confirmed")
            {
                await PromoteNextWaitlistAsync(connection, tx, packedFriendSocialId, cancellationToken);
            }

            await RepackSocialCourtsAsync(connection, tx, packedFriendSocialId, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
        return restore;
    }

    public async Task<bool> RenameSocialFriendAsync(Guid userId, Guid friendId, string name, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            SET f.DisplayName = @Name
            WHERE f.Id = @Id AND r.UserId = @UserId
              AND f.Status IN ('pending', 'confirmed', 'waitlist')
              AND s.StartTime > UTC_TIMESTAMP(6)
            """,
            new { Id = friendId, UserId = userId, Name = name },
            cancellationToken: cancellationToken));
        return changed == 1;
    }

    public async Task<FriendListRow[]> ListSocialFriendsAsync(Guid userId, Guid socialId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<FriendListRow>(new CommandDefinition(
            """
            SELECT f.Id, f.DisplayName, f.Status, f.Amount, f.CheckoutGroupId, COALESCE(c.CourtName, 'Waitlist') AS CourtName, s.StartTime
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            LEFT JOIN Courts c ON c.Id = f.CourtId
            WHERE r.UserId = @UserId AND f.SocialId = @SocialId
              AND f.Status IN ('pending', 'confirmed', 'waitlist')
            ORDER BY f.CreatedAt
            """,
            new { UserId = userId, SocialId = socialId },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<int> SocialPlacesLeftAsync(Guid venueId, Guid socialId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var room = await connection.QuerySingleOrDefaultAsync<SocialRoomRow>(new CommandDefinition(
            """
            SELECT PlayersPerCourt, MaxCourts
            FROM PublicSocials
            WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
            """,
            new { Id = socialId, VenueId = venueId },
            cancellationToken: cancellationToken));
        if (room is null)
        {
            return 0;
        }

        var courts = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM Courts WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0",
            new { VenueId = venueId },
            cancellationToken: cancellationToken));
        var occupied = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT
                (SELECT COUNT(*) FROM PublicSocialRegistrations
                 WHERE SocialId = @SocialId
                   AND (Status = 'confirmed' OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))))
              + (SELECT COUNT(*) FROM PublicSocialFriends
                 WHERE SocialId = @SocialId
                   AND (Status = 'confirmed' OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))))
            """,
            new { SocialId = socialId },
            cancellationToken: cancellationToken));
        return Math.Max(0, AllowedCourtCount(courts, room.MaxCourts) * NormalizePlayersPerCourt(room.PlayersPerCourt) - occupied);
    }

    public async Task<FriendBookingRow[]> ListBookingFriendsAsync(Guid userId, IReadOnlyCollection<Guid> registrationIds, CancellationToken cancellationToken)
    {
        if (registrationIds.Count == 0)
        {
            return [];
        }

        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<FriendBookingRow>(new CommandDefinition(
            """
            SELECT f.Id, owner.Id AS RegistrationId, f.DisplayName, f.Status, f.Amount, s.StartTime,
                   COALESCE(c.CourtName, 'Waitlist') AS CourtName
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations linked ON linked.Id = f.RegistrationId
            JOIN PublicSocialRegistrations owner ON owner.UserId = linked.UserId AND owner.SocialId = f.SocialId AND owner.Id IN @Ids
            JOIN PublicSocials s ON s.Id = f.SocialId
            LEFT JOIN Courts c ON c.Id = f.CourtId
            WHERE linked.UserId = @UserId
              AND f.Status IN ('pending', 'confirmed', 'waitlist')
            ORDER BY f.CreatedAt
            """,
            new { UserId = userId, Ids = registrationIds },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<(FriendSpotRow[] Items, int Total)> ListFriendSpotsAsync(
        Guid userId,
        string status,
        int offset,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var filter = status switch
        {
            "past" => "f.Status = 'confirmed' AND s.EndTime <= UTC_TIMESTAMP(6)",
            "cancelled" => "f.Status IN ('cancelled', 'expired')",
            _ => """
                (
                    f.Status = 'confirmed'
                    OR (f.Status = 'waitlist' AND (f.HoldExpiresAt IS NULL OR f.HoldExpiresAt > UTC_TIMESTAMP(6)))
                    OR (f.Status = 'pending' AND f.HoldExpiresAt > UTC_TIMESTAMP(6))
                )
                AND s.EndTime > UTC_TIMESTAMP(6)
                """,
        };
        var direction = status is "past" or "cancelled" ? "DESC" : "ASC";
        var from = $"""
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            LEFT JOIN Courts c ON c.Id = f.CourtId
            JOIN Venues v ON v.Id = f.VenueId
            WHERE r.UserId = @UserId AND {filter}
            """;
        await using var connection = await OpenAsync(cancellationToken);
        // Paged by session so every friend in a social stays together on one page.
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(DISTINCT f.SocialId) {from}",
            new { UserId = userId },
            cancellationToken: cancellationToken));
        var socialIds = (await connection.QueryAsync<Guid>(new CommandDefinition(
            $"""
            SELECT f.SocialId
            {from}
            GROUP BY f.SocialId, s.StartTime
            ORDER BY s.StartTime {direction}, f.SocialId
            LIMIT @Take OFFSET @Skip
            """,
            new { UserId = userId, Take = pageSize, Skip = offset },
            cancellationToken: cancellationToken))).ToArray();
        if (socialIds.Length == 0)
        {
            return ([], total);
        }

        var rows = await connection.QueryAsync<FriendSpotRow>(new CommandDefinition(
            $"""
            SELECT f.Id, f.DisplayName, f.Status, f.Amount,
                   COALESCE(c.CourtName, 'Waitlist') AS CourtName, COALESCE(c.CourtNumber, 0) AS CourtNumber,
                   v.Name AS VenueName, v.Slug AS VenueSlug, v.TimeZone, v.Currency,
                   s.Id AS SocialId, s.StartTime, s.EndTime, r.Status AS RegistrationStatus,
                   f.SubtotalAmount, f.DiscountAmount, f.PointsRedeemed, f.CreatedAt AS AddedAt, f.CancelledAt,
                   COALESCE(f.CancelFeePercent, 0) AS CancelFeePercent, v.LateCancelFeePercent AS LateFeePercent,
                   EXISTS (
                       SELECT 1 FROM PublicSocialPayments p
                       WHERE p.FriendGroupId = f.CheckoutGroupId AND p.Status IN ('succeeded', 'partially_refunded', 'refunded')
                   ) AS WasPaid,
                   CAST(CASE WHEN f.IncentiveAwardedAt IS NOT NULL THEN COALESCE(f.IncentivePoints, 0) ELSE 0 END AS SIGNED) AS PointsEarned
            {from} AND f.SocialId IN @SocialIds
            ORDER BY s.StartTime {direction}, f.SocialId, f.CreatedAt ASC
            """,
            new { UserId = userId, SocialIds = socialIds },
            cancellationToken: cancellationToken));
        return (rows.ToArray(), total);
    }

    public async Task ReleaseSocialGroupAsync(Guid groupId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<SocialPointRow>(new CommandDefinition(
            """
            SELECT Id, UserId, PointsRedeemed
            FROM PublicSocialRegistrations
            WHERE CheckoutGroupId = @GroupId AND Status = 'pending'
            FOR UPDATE
            """,
            new { GroupId = groupId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var row in rows)
        {
            await RestoreSocialPointsAsync(connection, tx, row.UserId, row.PointsRedeemed, cancellationToken);
        }

        if (rows.Length > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Status = 'pending' AND FriendGroupId IS NULL AND RegistrationId IN @Ids
                """,
                new { Ids = rows.Select(row => row.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
                WHERE Id IN @Ids AND Status IN ('pending', 'waitlist')
                """,
                new { Ids = rows.Select(row => row.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
    }

    private static decimal[] SplitMoney(decimal[] weights, decimal total)
    {
        var shares = new decimal[weights.Length];
        if (weights.Length == 0)
        {
            return shares;
        }

        var sum = weights.Sum();
        decimal assigned = 0;
        for (var index = 0; index < weights.Length; index++)
        {
            if (index == weights.Length - 1)
            {
                shares[index] = decimal.Round(total - assigned, 2, MidpointRounding.AwayFromZero);
                continue;
            }

            var share = sum <= 0 ? 0 : decimal.Round(total * weights[index] / sum, 2, MidpointRounding.AwayFromZero);
            shares[index] = share;
            assigned += share;
        }

        return shares;
    }

    private static int[] SplitInt(decimal[] weights, int total)
    {
        var shares = new int[weights.Length];
        if (weights.Length == 0)
        {
            return shares;
        }

        var sum = weights.Sum();
        var assigned = 0;
        for (var index = 0; index < weights.Length; index++)
        {
            if (index == weights.Length - 1)
            {
                shares[index] = total - assigned;
                continue;
            }

            var share = sum <= 0 ? 0 : (int)decimal.Round(total * weights[index] / sum, 0, MidpointRounding.AwayFromZero);
            shares[index] = share;
            assigned += share;
        }

        return shares;
    }

    public async Task AttachSocialPaymentAsync(
        Guid registrationId,
        Guid userId,
        string? customerId,
        string intentId,
        decimal amount,
        string currency,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(customerId))
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET StripeCustomerId = @CustomerId, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND (StripeCustomerId IS NULL OR StripeCustomerId = @CustomerId)
                """,
                new { Id = userId, CustomerId = customerId },
                tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO PublicSocialPayments
                (Id, RegistrationId, StripePaymentIntentId, Amount, Currency, Status, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @RegistrationId, @IntentId, @Amount, @Currency, 'pending', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            """,
            new
            {
                Id = Guid.NewGuid(),
                RegistrationId = registrationId,
                IntentId = intentId,
                Amount = amount,
                Currency = currency,
            },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
    }

    public async Task CancelSocialPaymentAsync(string intentId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE StripePaymentIntentId = @IntentId AND Status = 'pending'
            """,
            new { IntentId = intentId },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> SocialPaymentExistsAsync(string intentId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var count = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM PublicSocialPayments WHERE StripePaymentIntentId = @IntentId",
            new { IntentId = intentId },
            cancellationToken: cancellationToken));
        return count > 0;
    }

    public async Task<bool> BindSocialPaymentIntentAsync(Guid registrationId, string intentId, CancellationToken cancellationToken)
    {
        if (await SocialPaymentExistsAsync(intentId, cancellationToken))
        {
            return true;
        }

        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET StripePaymentIntentId = @IntentId, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE RegistrationId = @RegistrationId
              AND FriendGroupId IS NULL
              AND Status = 'pending'
              AND StripePaymentIntentId <> @IntentId
            ORDER BY CreatedAt DESC
            LIMIT 1
            """,
            new { RegistrationId = registrationId, IntentId = intentId },
            cancellationToken: cancellationToken));
        return await SocialPaymentExistsAsync(intentId, cancellationToken);
    }

    public async Task<SocialPaymentTransition?> MarkSocialSucceededAsync(string intentId, string? chargeId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<SocialPaymentStateRow>(new CommandDefinition(
            """
            SELECT r.Id AS RegistrationId, r.Status, p.Id AS PaymentId, p.Status AS PaymentStatus, p.Amount
            FROM PublicSocialPayments p
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            WHERE p.StripePaymentIntentId = @IntentId AND p.FriendGroupId IS NULL
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return null;
        }

        if (row.PaymentStatus is "pending" or "failed")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'succeeded', StripeChargeId = @ChargeId, PaidAt = UTC_TIMESTAMP(6), UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = row.PaymentId, ChargeId = chargeId },
                tx,
                cancellationToken: cancellationToken));
        }

        var action = row.Status switch
        {
            "pending" => "confirmed",
            "waitlist" => "waiting",
            "expired" or "cancelled" => "refund",
            _ => "already",
        };
        if (action == "waiting")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET HoldExpiresAt = NULL
                WHERE Id = @Id AND Status = 'waitlist'
                """,
                new { Id = row.RegistrationId },
                tx,
                cancellationToken: cancellationToken));
        }
        if (action == "confirmed")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Status = 'confirmed', ConfirmedAt = UTC_TIMESTAMP(6), HoldExpiresAt = NULL
                WHERE Id = @Id AND Status = 'pending'
                """,
                new { Id = row.RegistrationId },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations sibling
                JOIN PublicSocialRegistrations owner ON owner.CheckoutGroupId = sibling.CheckoutGroupId
                SET sibling.Status = 'confirmed', sibling.ConfirmedAt = UTC_TIMESTAMP(6), sibling.HoldExpiresAt = NULL
                WHERE owner.Id = @Id AND owner.CheckoutGroupId IS NOT NULL AND sibling.Status = 'pending'
                """,
                new { Id = row.RegistrationId },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        return new SocialPaymentTransition(action, row.RegistrationId, row.Amount, row.PaymentStatus);
    }

    public async Task<SocialPaymentTransition?> MarkWaitlistPaidAsync(string intentId, string? chargeId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<SocialPaymentStateRow>(new CommandDefinition(
            """
            SELECT r.Id AS RegistrationId, r.Status, p.Id AS PaymentId, p.Status AS PaymentStatus, p.Amount
            FROM PublicSocialPayments p
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            WHERE p.StripePaymentIntentId = @IntentId AND p.FriendGroupId IS NULL
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return null;
        }

        if (row.PaymentStatus is "pending" or "failed")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'succeeded', StripeChargeId = @ChargeId, PaidAt = UTC_TIMESTAMP(6), UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = row.PaymentId, ChargeId = chargeId },
                tx,
                cancellationToken: cancellationToken));
        }

        if (row.Status == "waitlist")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET HoldExpiresAt = NULL
                WHERE Id = @Id AND Status = 'waitlist'
                """,
                new { Id = row.RegistrationId },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        var action = row.Status == "waitlist" ? "waiting" : row.Status is "expired" or "cancelled" ? "refund" : "already";
        return new SocialPaymentTransition(action, row.RegistrationId, row.Amount, row.PaymentStatus);
    }

    public async Task ExtendSocialHoldAsync(string intentId, DateTime untilUtc, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations r
            JOIN PublicSocialPayments p ON p.RegistrationId = r.Id
            SET r.HoldExpiresAt = CASE
                    WHEN r.HoldExpiresAt IS NULL OR r.HoldExpiresAt < @Until THEN @Until
                    ELSE r.HoldExpiresAt
                END
            WHERE p.StripePaymentIntentId = @IntentId AND p.FriendGroupId IS NULL AND r.Status IN ('pending', 'waitlist')
            """,
            new { IntentId = intentId, Until = untilUtc },
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations sibling
            JOIN PublicSocialRegistrations owner ON owner.CheckoutGroupId = sibling.CheckoutGroupId
            JOIN PublicSocialPayments p ON p.RegistrationId = owner.Id
            SET sibling.HoldExpiresAt = CASE
                    WHEN sibling.HoldExpiresAt IS NULL OR sibling.HoldExpiresAt < @Until THEN @Until
                    ELSE sibling.HoldExpiresAt
                END
            WHERE p.StripePaymentIntentId = @IntentId AND p.FriendGroupId IS NULL AND sibling.Status = 'pending' AND owner.CheckoutGroupId IS NOT NULL
            """,
            new { IntentId = intentId, Until = untilUtc },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> FailSocialPendingAsync(string intentId, string paymentStatus, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<SocialPaymentStateRow>(new CommandDefinition(
            """
            SELECT r.Id AS RegistrationId, r.Status, p.Id AS PaymentId, p.Status AS PaymentStatus, p.Amount
            FROM PublicSocialPayments p
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            WHERE p.StripePaymentIntentId = @IntentId AND p.FriendGroupId IS NULL AND p.Status = 'pending' AND r.Status IN ('pending', 'waitlist')
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return false;
        }

        var points = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT PointsRedeemed FROM PublicSocialRegistrations WHERE Id = @Id",
            new { Id = row.RegistrationId },
            tx,
            cancellationToken: cancellationToken));
        await RestoreSocialPointsAsync(connection, tx, await SocialUserIdAsync(connection, tx, row.RegistrationId, cancellationToken), points, cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations
            SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND Status IN ('pending', 'waitlist')
            """,
            new { Id = row.RegistrationId },
            tx,
            cancellationToken: cancellationToken));
        var siblings = (await connection.QueryAsync<SocialPointRow>(new CommandDefinition(
            """
            SELECT sibling.Id, sibling.UserId, sibling.PointsRedeemed
            FROM PublicSocialRegistrations sibling
            JOIN PublicSocialRegistrations owner ON owner.CheckoutGroupId = sibling.CheckoutGroupId
            WHERE owner.Id = @Id AND owner.CheckoutGroupId IS NOT NULL AND sibling.Status = 'pending'
            FOR UPDATE
            """,
            new { Id = row.RegistrationId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var sibling in siblings)
        {
            await RestoreSocialPointsAsync(connection, tx, sibling.UserId, sibling.PointsRedeemed, cancellationToken);
        }

        if (siblings.Length > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialRegistrations
                SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
                WHERE Id IN @Ids AND Status = 'pending'
                """,
                new { Ids = siblings.Select(sibling => sibling.Id).ToArray() },
                tx,
                cancellationToken: cancellationToken));
        }
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET Status = @Status, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND Status = 'pending'
            """,
            new { Id = row.PaymentId, Status = paymentStatus },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task ReleaseSocialHoldAsync(Guid registrationId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<SocialPointRow>(new CommandDefinition(
            """
            SELECT Id, UserId, PointsRedeemed
            FROM PublicSocialRegistrations
            WHERE Id = @Id AND (Status = 'pending' OR (Status = 'waitlist' AND HoldExpiresAt IS NOT NULL))
            FOR UPDATE
            """,
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return;
        }

        await RestoreSocialPointsAsync(connection, tx, row.UserId, row.PointsRedeemed, cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE RegistrationId = @Id AND FriendGroupId IS NULL AND Status = 'pending'
            """,
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations
            SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND (Status = 'pending' OR (Status = 'waitlist' AND HoldExpiresAt IS NOT NULL))
            """,
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<SocialStatusRow?> FindOwnedSocialAsync(Guid userId, Guid registrationId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<SocialStatusRow>(new CommandDefinition(
            """
            SELECT r.Id, r.Status, r.Amount, r.PointsRedeemed, COALESCE(r.IncentivePoints, 0) AS IncentivePoints,
                   COALESCE(c.CourtName, '') AS CourtName, COALESCE(c.CourtNumber, 0) AS CourtNumber, p.Status AS PaymentStatus, p.StripePaymentIntentId
            FROM PublicSocialRegistrations r
            LEFT JOIN Courts c ON c.Id = r.CourtId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id FROM PublicSocialPayments p2
                WHERE p2.RegistrationId = r.Id AND p2.FriendGroupId IS NULL
                ORDER BY p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE r.Id = @Id AND r.UserId = @UserId
            """,
            new { Id = registrationId, UserId = userId },
            cancellationToken: cancellationToken));
    }

    public async Task<SocialCancelContext?> LoadSocialCancelAsync(Guid userId, Guid registrationId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<SocialCancelContext>(new CommandDefinition(
            """
            SELECT r.Id, r.Status, s.StartTime, v.Currency, v.LateCancelFeePercent,
                   p.Id AS PaymentId, p.StripePaymentIntentId, p.Status AS PaymentStatus, r.Amount AS PaymentAmount
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Venues v ON v.Id = r.VenueId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id
                FROM PublicSocialPayments p2
                JOIN PublicSocialRegistrations owner ON owner.Id = p2.RegistrationId
                WHERE p2.FriendGroupId IS NULL
                  AND (
                      owner.Id = r.Id
                      OR (r.CheckoutGroupId IS NOT NULL AND owner.CheckoutGroupId = r.CheckoutGroupId)
                  )
                ORDER BY CASE WHEN owner.Id = r.Id THEN 0 ELSE 1 END, p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE r.Id = @Id AND r.UserId = @UserId
            """,
            new { Id = registrationId, UserId = userId },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> CompleteSocialCancelAsync(SocialCancelWrite write, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var locked = await connection.QuerySingleOrDefaultAsync<CancelLockRow>(new CommandDefinition(
            """
            SELECT r.SocialId, r.Status, r.PointsRedeemed
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            WHERE r.Id = @Id AND r.UserId = @UserId
              AND r.Status IN ('pending', 'confirmed', 'waitlist')
              AND s.StartTime > UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            write,
            tx,
            cancellationToken: cancellationToken));
        if (locked is null)
        {
            return false;
        }

        var restore = write.FeePercent <= 0
            ? locked.PointsRedeemed
            : (int)Math.Floor(locked.PointsRedeemed * (100m - write.FeePercent) / 100m);
        await RestoreSocialPointsAsync(connection, tx, write.UserId, restore, cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            SET r.Status = 'cancelled',
                r.CancelledAt = UTC_TIMESTAMP(6),
                r.CancelFeePercent = @FeePercent
            WHERE r.Id = @Id AND r.UserId = @UserId
              AND r.Status IN ('pending', 'confirmed', 'waitlist')
              AND s.StartTime > UTC_TIMESTAMP(6)
            """,
            write,
            tx,
            cancellationToken: cancellationToken));
        if (changed != 1)
        {
            return false;
        }

        var paymentStatus = write.PaymentStatus;
        var groupId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "SELECT CheckoutGroupId FROM PublicSocialRegistrations WHERE Id = @Id",
            new { write.Id },
            tx,
            cancellationToken: cancellationToken));
        if (groupId is not null && paymentStatus == "refunded")
        {
            var others = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*) FROM PublicSocialRegistrations
                WHERE CheckoutGroupId = @GroupId AND Id <> @Id AND Status IN ('pending', 'confirmed')
                """,
                new { GroupId = groupId, write.Id },
                tx,
                cancellationToken: cancellationToken));
            if (others > 0)
            {
                paymentStatus = "partially_refunded";
            }
        }

        if (groupId is not null && paymentStatus == "cancelled")
        {
            var siblings = (await connection.QueryAsync<SocialPointRow>(new CommandDefinition(
                """
                SELECT Id, UserId, PointsRedeemed
                FROM PublicSocialRegistrations
                WHERE CheckoutGroupId = @GroupId AND Id <> @Id AND Status = 'pending'
                FOR UPDATE
                """,
                new { GroupId = groupId, write.Id },
                tx,
                cancellationToken: cancellationToken))).ToArray();
            foreach (var sibling in siblings)
            {
                await RestoreSocialPointsAsync(connection, tx, sibling.UserId, sibling.PointsRedeemed, cancellationToken);
            }

            if (siblings.Length > 0)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE PublicSocialRegistrations
                    SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
                    WHERE Id IN @Ids AND Status = 'pending'
                    """,
                    new { Ids = siblings.Select(sibling => sibling.Id).ToArray() },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        if (write.PaymentId is not null && paymentStatus is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = @Status, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = write.PaymentId, Status = paymentStatus },
                tx,
                cancellationToken: cancellationToken));
        }

        if (!string.IsNullOrWhiteSpace(write.StripeRefundId) && write.PaymentId is not null && write.RefundAmount > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PublicSocialRefunds
                    (Id, PaymentId, StripeRefundId, Amount, Reason, Status, RequestedBy, ProcessedAt, CreatedAt)
                VALUES
                    (@Id, @PaymentId, @StripeRefundId, @Amount, 'Drop-in social cancelled', @Status, @UserId,
                     CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    write.PaymentId,
                    write.StripeRefundId,
                    Amount = write.RefundAmount,
                    Status = write.RefundStatus,
                    write.UserId,
                },
                tx,
                cancellationToken: cancellationToken));
        }

        var socialId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "SELECT SocialId FROM PublicSocialRegistrations WHERE Id = @Id",
            new { write.Id },
            tx,
            cancellationToken: cancellationToken));
        if (socialId is Guid packedSocialId)
        {
            if (locked.Status is "pending" or "confirmed")
            {
                await PromoteNextWaitlistAsync(connection, tx, packedSocialId, cancellationToken);
            }

            await RepackSocialCourtsAsync(connection, tx, packedSocialId, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<StartedWaitlistRow[]> ListStartedWaitlistsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<StartedWaitlistRow>(new CommandDefinition(
            """
            SELECT r.Id, r.UserId, r.PointsRedeemed, r.Amount,
                   p.StripePaymentIntentId, p.Status AS PaymentStatus
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id
                FROM PublicSocialPayments p2
                WHERE p2.RegistrationId = r.Id AND p2.FriendGroupId IS NULL
                ORDER BY p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE r.Status = 'waitlist' AND r.HoldExpiresAt IS NULL AND s.StartTime <= UTC_TIMESTAMP(6)
            """,
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<bool> CompleteStartedWaitlistAsync(
        Guid registrationId,
        string? stripeRefundId,
        string refundStatus,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<StartedWaitlistRow>(new CommandDefinition(
            """
            SELECT r.Id, r.UserId, r.PointsRedeemed, r.Amount,
                   p.Id AS PaymentId, p.StripePaymentIntentId, p.Status AS PaymentStatus
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id
                FROM PublicSocialPayments p2
                WHERE p2.RegistrationId = r.Id AND p2.FriendGroupId IS NULL
                ORDER BY p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE r.Id = @Id AND r.Status = 'waitlist' AND r.HoldExpiresAt IS NULL AND s.StartTime <= UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return false;
        }

        await RestoreSocialPointsAsync(connection, tx, row.UserId, row.PointsRedeemed, cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations
            SET Status = 'cancelled', CancelledAt = UTC_TIMESTAMP(6), CancelFeePercent = 0
            WHERE Id = @Id AND Status = 'waitlist'
            """,
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
        if (changed != 1)
        {
            return false;
        }

        if (row.PaymentId is Guid paymentId && row.PaymentStatus == "succeeded" && row.Amount > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'refunded', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = paymentId },
                tx,
                cancellationToken: cancellationToken));
            if (!string.IsNullOrWhiteSpace(stripeRefundId))
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO PublicSocialRefunds
                        (Id, PaymentId, StripeRefundId, Amount, Reason, Status, ProcessedAt, CreatedAt)
                    VALUES
                        (@Id, @PaymentId, @StripeRefundId, @Amount, 'Session started before a place opened', @Status,
                         CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                         UTC_TIMESTAMP(6))
                    """,
                    new
                    {
                        Id = Guid.NewGuid(),
                        PaymentId = paymentId,
                        StripeRefundId = stripeRefundId,
                        Amount = row.Amount,
                        Status = refundStatus,
                    },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<StartedWaitlistRow[]> ListStartedFriendWaitlistsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<StartedWaitlistRow>(new CommandDefinition(
            """
            SELECT f.Id, r.UserId, f.PointsRedeemed, f.Amount,
                   p.StripePaymentIntentId, p.Status AS PaymentStatus
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id
                FROM PublicSocialPayments p2
                WHERE p2.FriendGroupId = f.CheckoutGroupId
                ORDER BY p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE f.Status = 'waitlist' AND f.HoldExpiresAt IS NULL AND s.StartTime <= UTC_TIMESTAMP(6)
            """,
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<bool> CompleteStartedFriendWaitlistAsync(
        Guid friendId,
        string? stripeRefundId,
        string refundStatus,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<StartedWaitlistRow>(new CommandDefinition(
            """
            SELECT f.Id, r.UserId, f.PointsRedeemed, f.Amount,
                   p.Id AS PaymentId, p.StripePaymentIntentId, p.Status AS PaymentStatus
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            JOIN PublicSocials s ON s.Id = f.SocialId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id
                FROM PublicSocialPayments p2
                WHERE p2.FriendGroupId = f.CheckoutGroupId
                ORDER BY p2.CreatedAt DESC
                LIMIT 1
            )
            WHERE f.Id = @Id AND f.Status = 'waitlist' AND f.HoldExpiresAt IS NULL AND s.StartTime <= UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            new { Id = friendId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return false;
        }

        await RestoreSocialPointsAsync(connection, tx, row.UserId, row.PointsRedeemed, cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialFriends
            SET Status = 'cancelled', CancelledAt = UTC_TIMESTAMP(6), CancelFeePercent = 0
            WHERE Id = @Id AND Status = 'waitlist'
            """,
            new { Id = friendId },
            tx,
            cancellationToken: cancellationToken));
        if (changed != 1)
        {
            return false;
        }

        if (row.PaymentId is Guid paymentId && row.PaymentStatus is "succeeded" or "partially_refunded" && row.Amount > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'partially_refunded', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND Status IN ('succeeded', 'partially_refunded')
                """,
                new { Id = paymentId },
                tx,
                cancellationToken: cancellationToken));
            if (!string.IsNullOrWhiteSpace(stripeRefundId))
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO PublicSocialRefunds
                        (Id, PaymentId, StripeRefundId, Amount, Reason, Status, ProcessedAt, CreatedAt)
                    VALUES
                        (@Id, @PaymentId, @StripeRefundId, @Amount, 'Session started before a place opened', @Status,
                         CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                         UTC_TIMESTAMP(6))
                    """,
                    new
                    {
                        Id = Guid.NewGuid(),
                        PaymentId = paymentId,
                        StripeRefundId = stripeRefundId,
                        Amount = row.Amount,
                        Status = refundStatus,
                    },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task RecordSocialRefundAsync(
        string intentId,
        string stripeRefundId,
        decimal amount,
        string status,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var paymentId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "SELECT Id FROM PublicSocialPayments WHERE StripePaymentIntentId = @IntentId",
            new { IntentId = intentId },
            cancellationToken: cancellationToken));
        if (paymentId is null)
        {
            return;
        }

        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PublicSocialRefunds
                    (Id, PaymentId, StripeRefundId, Amount, Reason, Status, ProcessedAt, CreatedAt)
                VALUES
                    (@Id, @PaymentId, @StripeRefundId, @Amount, 'Seat released before payment finished', @Status,
                     CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    PaymentId = paymentId,
                    StripeRefundId = stripeRefundId,
                    Amount = amount,
                    Status = status,
                },
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return;
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialPayments
            SET Status = 'refunded', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND Status <> 'refunded'
            """,
            new { Id = paymentId },
            cancellationToken: cancellationToken));
    }

    private static async Task ExpireFriendHoldsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        CancellationToken cancellationToken)
    {
        var groups = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT DISTINCT CheckoutGroupId
            FROM PublicSocialFriends
            WHERE (Status = 'pending' OR Status = 'waitlist')
              AND HoldExpiresAt IS NOT NULL
              AND HoldExpiresAt <= UTC_TIMESTAMP(6)
            """,
            transaction: tx,
            cancellationToken: cancellationToken))).ToArray();
        foreach (var groupId in groups)
        {
            await ReleaseFriendRowsAsync(connection, tx, groupId, cancelPayment: true, cancellationToken);
        }
    }

    private static async Task<string?> ReleasePendingFriendsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid registrationId,
        CancellationToken cancellationToken)
    {
        var groups = (await connection.QueryAsync<FriendGroupIntentRow>(new CommandDefinition(
            """
            SELECT f.CheckoutGroupId AS GroupId,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM PublicSocialPayments p
                       WHERE p.FriendGroupId = f.CheckoutGroupId AND p.Status = 'pending'
                       ORDER BY p.CreatedAt DESC
                       LIMIT 1
                   ) AS StripePaymentIntentId
            FROM PublicSocialFriends f
            WHERE f.RegistrationId = @RegistrationId
              AND (f.Status = 'pending' OR (f.Status = 'waitlist' AND f.HoldExpiresAt IS NOT NULL))
            GROUP BY f.CheckoutGroupId
            """,
            new { RegistrationId = registrationId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        string? intent = null;
        foreach (var group in groups)
        {
            intent ??= group.StripePaymentIntentId;
            await ReleaseFriendRowsAsync(connection, tx, group.GroupId, cancelPayment: true, cancellationToken);
        }

        return intent;
    }

    private static async Task ReleaseFriendRowsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid groupId,
        bool cancelPayment,
        CancellationToken cancellationToken)
    {
        var rows = (await connection.QueryAsync<PendingFriendReleaseRow>(new CommandDefinition(
            """
            SELECT f.Id, r.UserId, f.PointsRedeemed, f.PromotionCodeId
            FROM PublicSocialFriends f
            JOIN PublicSocialRegistrations r ON r.Id = f.RegistrationId
            WHERE f.CheckoutGroupId = @GroupId
              AND (f.Status = 'pending' OR (f.Status = 'waitlist' AND f.HoldExpiresAt IS NOT NULL))
            FOR UPDATE
            """,
            new { GroupId = groupId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (rows.Length == 0)
        {
            return;
        }

        foreach (var row in rows)
        {
            await RestoreSocialPointsAsync(connection, tx, row.UserId, row.PointsRedeemed, cancellationToken);
        }

        var promoId = rows.Select(row => row.PromotionCodeId).FirstOrDefault(id => id is not null);
        if (promoId is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE PromotionCodes SET UsedCount = GREATEST(UsedCount - 1, 0), UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                new { Id = promoId },
                tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialFriends
            SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
            WHERE Id IN @Ids AND (Status = 'pending' OR (Status = 'waitlist' AND HoldExpiresAt IS NOT NULL))
            """,
            new { Ids = rows.Select(row => row.Id).ToArray() },
            tx,
            cancellationToken: cancellationToken));
        if (cancelPayment)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PublicSocialPayments
                SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE FriendGroupId = @GroupId AND Status = 'pending'
                """,
                new { GroupId = groupId },
                tx,
                cancellationToken: cancellationToken));
        }
    }

    private async Task<MySqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The MySQL connection string is not configured.");
        }

        var builder = new MySqlConnectionStringBuilder(connectionString)
        {
            GuidFormat = MySqlGuidFormat.Char36,
        };
        var connection = new MySqlConnection(builder.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private static async Task<int> SocialIncentivePointsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        string timeZone,
        DateTime startUtc,
        CancellationToken cancellationToken)
    {
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(timeZone) ? "Australia/Melbourne" : timeZone);
        }
        catch (TimeZoneNotFoundException)
        {
            zone = TimeZoneInfo.Utc;
        }

        var local = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone));
        var points = await connection.ExecuteScalarAsync<int?>(new CommandDefinition(
            """
            SELECT Points FROM VenueIncentives
            WHERE VenueId = @VenueId AND IsActive = 1
              AND StartsOn <= @Day AND EndsOn >= @Day
            ORDER BY StartsOn
            LIMIT 1
            """,
            new { VenueId = venueId, Day = local.ToDateTime(TimeOnly.MinValue) },
            tx,
            cancellationToken: cancellationToken));
        return points ?? 0;
    }

    private static async Task<(Guid? PromoId, decimal Discount, string? Error)> LockSocialPromotionAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        decimal price,
        string? code,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return (null, 0, null);
        }

        var promo = await connection.QuerySingleOrDefaultAsync<SocialPromoRow>(new CommandDefinition(
            """
            SELECT Id, DiscountType, DiscountValue
            FROM PromotionCodes
            WHERE Code = @Code AND IsActive = 1
              AND ValidFrom <= UTC_TIMESTAMP(6) AND ValidTo > UTC_TIMESTAMP(6)
              AND (VenueId IS NULL OR VenueId = @VenueId)
            FOR UPDATE
            """,
            new { Code = code.Trim().ToUpperInvariant(), VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (promo is null)
        {
            return (null, 0, "That promotion code is not valid.");
        }

        var discount = promo.DiscountType == "percent"
            ? decimal.Round(price * promo.DiscountValue / 100m, 2, MidpointRounding.AwayFromZero)
            : promo.DiscountValue;
        if (discount > price)
        {
            discount = price;
        }

        return discount <= 0 ? (null, 0, "That promotion code is not valid.") : (promo.Id, discount, null);
    }

    private static async Task<Guid> SocialUserIdAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid registrationId,
        CancellationToken cancellationToken)
    {
        return await connection.ExecuteScalarAsync<Guid>(new CommandDefinition(
            "SELECT UserId FROM PublicSocialRegistrations WHERE Id = @Id",
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
    }

    private static async Task RestoreSocialPointsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid userId,
        int points,
        CancellationToken cancellationToken)
    {
        if (points <= 0 || userId == Guid.Empty)
        {
            return;
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Users
            SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @UserId
            """,
            new { UserId = userId, Points = points },
            tx,
            cancellationToken: cancellationToken));
    }

    public async Task EnsurePaidSeriesAsync(Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<PaidSeriesRow>(new CommandDefinition(
            """
            SELECT b.GroupId, b.UserId, b.VenueId, v.TimeZone, v.HourlyRate,
                   CAST(COALESCE(b.SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold,
                   cs.StartTime, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.Id = @Id AND b.Status = 'confirmed' AND b.IsDeleted = 0 AND b.GroupId IS NOT NULL
            """,
            new { Id = bookingId },
            cancellationToken: cancellationToken));
        if (row is null || row.SeriesWeeks <= 1)
        {
            return;
        }

        var existing = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(DISTINCT cs.StartTime)
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.GroupId = @GroupId AND b.IsDeleted = 0 AND b.Status IN ('pending', 'confirmed')
            """,
            new { row.GroupId },
            cancellationToken: cancellationToken));
        if (existing >= row.SeriesWeeks)
        {
            return;
        }

        var courts = (await connection.QueryAsync<Guid>(new CommandDefinition(
            """
            SELECT DISTINCT cs.CourtId
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.GroupId = @GroupId AND b.IsDeleted = 0 AND b.Status = 'confirmed'
              AND cs.StartTime = @StartTime
            """,
            new { row.GroupId, row.StartTime },
            cancellationToken: cancellationToken))).ToArray();
        if (courts.Length == 0)
        {
            return;
        }

        var opened = await OpenCourtHoldGroupAsync(
            row.VenueId,
            row.UserId,
            courts,
            row.HourlyRate,
            row.TimeZone,
            row.StartTime,
            row.EndTime,
            row.SeriesWeeks,
            cancellationToken,
            joinGroupId: row.GroupId,
            seriesWeeks: row.SeriesWeeks,
            repeatHold: row.RepeatHold == 1);
        if (opened.Error is not null)
        {
            await SetRepeatNoteAsync(row.GroupId, row.UserId, opened.Error, cancellationToken);
        }
    }

    private static async Task<string?> SocialBusyMessageAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        string timeZone,
        IReadOnlyCollection<Guid> courtIds,
        DateTime startUtc,
        DateTime endUtc,
        CancellationToken cancellationToken)
    {
        var socials = (await connection.QueryAsync<SocialWindowRow>(new CommandDefinition(
            """
            SELECT StartTime, EndTime, MaxCourts, CAST(RepeatWeekly AS SIGNED) AS RepeatWeekly
            FROM PublicSocials
            WHERE VenueId = @VenueId AND IsDeleted = 0
              AND (
                  (StartTime < @EndTime AND EndTime > @StartTime)
                  OR (RepeatWeekly = 1 AND SuccessorId IS NULL AND EndTime > UTC_TIMESTAMP(6))
              )
            """,
            new { VenueId = venueId, StartTime = startUtc, EndTime = endUtc },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (socials.Length == 0)
        {
            return null;
        }

        var catalog = (await connection.QueryAsync<ReserveCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName, CourtNumber
            FROM Courts
            WHERE VenueId = @VenueId AND IsActive = 1 AND IsDeleted = 0
            ORDER BY CourtNumber
            """,
            new { VenueId = venueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        var wanted = courtIds.ToHashSet();
        foreach (var social in socials)
        {
            if (!SocialCovers(timeZone, social.StartTime, social.EndTime, social.RepeatWeekly == 1, startUtc, endUtc, out var showStart, out var showEnd))
            {
                continue;
            }

            var count = social.MaxCourts is null or < 1 ? catalog.Length : Math.Min(social.MaxCourts.Value, catalog.Length);
            var reserved = catalog.Take(count).Where(court => wanted.Contains(court.Id)).Select(court => court.CourtName).ToArray();
            if (reserved.Length == 0)
            {
                continue;
            }

            var names = JoinCourtNames(reserved);
            var verb = reserved.Length == 1 ? "is" : "are";
            return $"{names} {verb} busy from {HoldWhen(timeZone, showStart)} to {HoldWhen(timeZone, showEnd)} for a drop-in social. This booking was not saved. Choose different courts or a different date and time.";
        }

        return null;
    }

    private static bool SocialCovers(string timeZone, DateTime socialStartUtc, DateTime socialEndUtc, bool repeatWeekly, DateTime startUtc, DateTime endUtc, out DateTime showStartUtc, out DateTime showEndUtc)
    {
        showStartUtc = socialStartUtc;
        showEndUtc = socialEndUtc;
        if (socialStartUtc < endUtc && socialEndUtc > startUtc)
        {
            return true;
        }

        if (!repeatWeekly || !TryLocal(timeZone, socialStartUtc, out var socialStart) || !TryLocal(timeZone, socialEndUtc, out var socialEnd) || !TryLocal(timeZone, startUtc, out var windowStart) || !TryLocal(timeZone, endUtc, out var windowEnd))
        {
            return false;
        }

        if (socialStart.DayOfWeek != windowStart.DayOfWeek)
        {
            return false;
        }

        var socialFrom = socialStart.TimeOfDay;
        var socialTo = socialEnd.Date == socialStart.Date ? socialEnd.TimeOfDay : TimeSpan.FromHours(24);
        var windowFrom = windowStart.TimeOfDay;
        var windowTo = windowEnd.Date == windowStart.Date ? windowEnd.TimeOfDay : TimeSpan.FromHours(24);
        if (socialFrom >= windowTo || socialTo <= windowFrom)
        {
            return false;
        }

        var days = (windowStart.Date - socialStart.Date).Days;
        var shift = (int)Math.Round(days / 7d) * 7;
        return ShuttleSync.Api.Booking.VenueClock.TryShiftDays(timeZone, socialStartUtc, socialEndUtc, shift, out showStartUtc, out showEndUtc)
            && showStartUtc < endUtc
            && showEndUtc > startUtc;
    }

    private static bool TryLocal(string timeZone, DateTime utc, out DateTime local)
    {
        local = default;
        try
        {
            local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(timeZone));
            return true;
        }
        catch (TimeZoneNotFoundException)
        {
            return false;
        }
    }

    private static string JoinCourtNames(IReadOnlyList<string> names)
    {
        if (names.Count <= 1)
        {
            return names.Count == 0 ? "That court" : names[0];
        }

        if (names.Count == 2)
        {
            return $"{names[0]} and {names[1]}";
        }

        return $"{string.Join(", ", names.Take(names.Count - 1))}, and {names[^1]}";
    }

    private static string HoldWhen(string timeZone, DateTime startUtc)
    {
        try
        {
            var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
            return local.ToString("ddd d MMM yyyy, h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (TimeZoneNotFoundException)
        {
            return startUtc.ToString("yyyy-MM-dd HH:mm", System.Globalization.CultureInfo.InvariantCulture);
        }
    }

    private static bool SameInstant(DateTime left, DateTime right) =>
        Math.Abs(left.Ticks - right.Ticks) < TimeSpan.TicksPerSecond;

    private static string OccupiedMessage(string courtName, string timeZone, DateTime startUtc, DateTime endUtc, Guid ownerId, Guid currentUserId)
    {
        var from = HoldWhen(timeZone, startUtc);
        var to = HoldWhen(timeZone, endUtc);
        if (ownerId == currentUserId)
        {
            return $"{courtName} is already in your bookings from {from} to {to}, and the payment is not finished. Complete the payment or delete it in My bookings.";
        }

        return $"{courtName} is not available from {from} to {to}. That time is already booked or held. Choose another time or court.";
    }

    private static async Task<Guid> LiveOwnerAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        return await connection.ExecuteScalarAsync<Guid>(new CommandDefinition(
            """
            SELECT UserId
            FROM Bookings
            WHERE CourtSessionId = @Id AND IsDeleted = 0
              AND Status NOT IN ('cancelled', 'expired')
              AND NOT (
                  Status = 'pending'
                  AND HoldExpiresAt IS NOT NULL
                  AND HoldExpiresAt <= UTC_TIMESTAMP(6)
              )
            LIMIT 1
            """,
            new { Id = sessionId },
            tx,
            cancellationToken: cancellationToken));
    }

    private static async Task<ActiveOverlap?> ActiveOverlapAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        IReadOnlyList<OverlapSessionRow> overlaps,
        CancellationToken cancellationToken)
    {
        if (overlaps.Count == 0)
        {
            return null;
        }

        var busy = await connection.QueryFirstOrDefaultAsync<BusyOwnerRow>(new CommandDefinition(
            """
            SELECT CourtSessionId, UserId
            FROM Bookings
            WHERE CourtSessionId IN @Ids AND IsDeleted = 0
              AND Status NOT IN ('cancelled', 'expired')
              AND NOT (
                  Status = 'pending'
                  AND HoldExpiresAt IS NOT NULL
                  AND HoldExpiresAt <= UTC_TIMESTAMP(6)
              )
            LIMIT 1
            """,
            new { Ids = overlaps.Select(row => row.Id).ToArray() },
            tx,
            cancellationToken: cancellationToken));
        if (busy is null)
        {
            return null;
        }

        var session = overlaps.FirstOrDefault(row => row.Id == busy.CourtSessionId);
        return session is null ? null : new ActiveOverlap(session, busy.UserId);
    }

    private sealed record ActiveOverlap(OverlapSessionRow Session, Guid UserId);

    // Only one live session may start at a given instant on a court, so a stale same-start slot is reused.
    private static async Task<Guid> ReuseOrInsertSessionAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        IReadOnlyList<OverlapSessionRow> overlaps,
        Guid venueId,
        Guid courtId,
        DateTime startUtc,
        DateTime endUtc,
        decimal price,
        CancellationToken cancellationToken)
    {
        var stale = overlaps.FirstOrDefault(row => SameInstant(row.StartTime, startUtc));
        if (stale is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "UPDATE CourtSessions SET EndTime = @EndTime, Price = @Price, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                new { Id = stale.Id, EndTime = endUtc, Price = price },
                tx,
                cancellationToken: cancellationToken));
            return stale.Id;
        }

        var id = Guid.NewGuid();
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO CourtSessions
                (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            """,
            new { Id = id, VenueId = venueId, CourtId = courtId, StartTime = startUtc, EndTime = endUtc, Price = price },
            tx,
            cancellationToken: cancellationToken));
        return id;
    }

    private sealed class BusyOwnerRow
    {
        public Guid CourtSessionId { get; init; }
        public Guid UserId { get; init; }
    }

    private sealed class MoveSessionRow
    {
        public Guid Id { get; init; }
        public Guid CourtSessionId { get; init; }
        public string Status { get; init; } = "";
        public Guid VenueId { get; init; }
        public Guid CourtId { get; init; }
        public string CourtName { get; init; } = "";
        public string TimeZone { get; init; } = "";
        public decimal HourlyRate { get; init; }
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
        public decimal DiscountAmount { get; init; }
        public int PointsRedeemed { get; init; }
    }

    private const string VenueColumns = """
        Id, Name, Slug, Description, Address, Suburb, State, Postcode, Country,
        Latitude, Longitude, Phone, Email, ImageUrl, TimeZone, Currency,
        LateCancelFeePercent, PointsPerDollar, HourlyRate, SocialPrice
        """;

    private sealed class PaidSeriesRow
    {
        public Guid GroupId { get; init; }
        public Guid UserId { get; init; }
        public Guid VenueId { get; init; }
        public string TimeZone { get; init; } = "";
        public decimal HourlyRate { get; init; }
        public int SeriesWeeks { get; init; }
        public int RepeatHold { get; init; }
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
    }

    private sealed class SocialWindowRow
    {
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
        public int? MaxCourts { get; init; }
        public int RepeatWeekly { get; init; }
    }

    private sealed class ReserveCourtRow
    {
        public Guid Id { get; init; }
        public string CourtName { get; init; } = "";
        public int CourtNumber { get; init; }
    }
}

public sealed class VenueRow
{
    public Guid Id { get; init; }
    public string Name { get; init; } = "";
    public string Slug { get; init; } = "";
    public string? Description { get; init; }
    public string? Address { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Postcode { get; init; }
    public string Country { get; init; } = "";
    public decimal? Latitude { get; init; }
    public decimal? Longitude { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? ImageUrl { get; init; }
    public string TimeZone { get; init; } = "Australia/Melbourne";
    public string Currency { get; init; } = "AUD";
    public decimal LateCancelFeePercent { get; init; }
    public int PointsPerDollar { get; init; } = 100;
    public decimal HourlyRate { get; init; }
    public decimal SocialPrice { get; init; }
}

public sealed class OpenHoldPriceRow
{
    public Guid Id { get; set; }
    public Guid CourtSessionId { get; set; }
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
}

public sealed class HoldCourtRow
{
    public Guid Id { get; init; }
    public string CourtName { get; init; } = "";
}

public sealed class WeekSampleRow
{
    public Guid GroupId { get; init; }
    public decimal Price { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public int SeriesWeeks { get; init; }
    public int RepeatHold { get; init; }
}

public sealed class RepeatSettingRow
{
    public int SeriesWeeks { get; init; }
    public int RepeatHold { get; init; }
}

public sealed class RepeatGroupRow
{
    public Guid GroupId { get; init; }
    public Guid UserId { get; init; }
    public Guid VenueId { get; init; }
    public int SeriesWeeks { get; init; }
    public string TimeZone { get; init; } = "";
    public decimal HourlyRate { get; init; }
}

public sealed class RepeatSlotRow
{
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public decimal Price { get; init; }
}

public sealed class RepeatAddedRow
{
    public Guid VenueId { get; init; }
    public Guid UserId { get; init; }
    public Guid SessionId { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class CourtWeekRow
{
    public Guid BookingId { get; init; }
    public Guid GroupId { get; init; }
    public string Status { get; init; } = "";
    public decimal Price { get; init; }
    public int SeriesWeeks { get; init; }
    public int RepeatHold { get; init; }
    public string? RepeatNote { get; init; }
    public string VenueName { get; init; } = "";
    public string VenueSlug { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string Currency { get; init; } = "";
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class CourtHoldRow
{
    public Guid BookingId { get; init; }
    public Guid SessionId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public string Status { get; init; } = "";
    public DateTime? HoldExpiresAt { get; init; }
    public int IncentivePoints { get; init; }
}

public sealed class OverlapSessionRow
{
    public Guid Id { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class PublicCourtRow
{
    public Guid Id { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string? SurfaceType { get; init; }
    public string? ImageUrl { get; init; }
    public string? Description { get; init; }
}

public sealed class ConfirmedBookingRow
{
    public Guid BookingId { get; init; }
    public Guid CourtId { get; init; }
    public string Status { get; init; } = "";
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class ReleasedHoldRow
{
    public Guid CourtId { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public int SeriesWeeks { get; init; }
    public int RepeatHold { get; init; }
}

public sealed class UnpaidHoldRow
{
    public Guid GroupId { get; init; }
    public string VenueName { get; init; } = "";
    public string VenueSlug { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public int CourtCount { get; init; }
    public bool CheckoutStarted { get; init; }
    public Guid[] BookingIds { get; init; } = [];
}

public sealed class PublicClosureRow
{
    public Guid Id { get; init; }
    public Guid? CourtId { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class SupportSessionRow
{
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int Taken { get; init; }
}

public sealed class AvailabilityRow
{
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string? SurfaceType { get; init; }
    public string? ImageUrl { get; init; }
    public string? Description { get; init; }
    public Guid SessionId { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int? IncentivePoints { get; init; }
}

public sealed class SlotRow
{
    public Guid Id { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int? IncentivePoints { get; init; }
}

public sealed class PublicIncentiveRow
{
    public Guid Id { get; init; }
    public int Points { get; init; }
    public DateTime StartsOn { get; init; }
    public DateTime EndsOn { get; init; }
}

public sealed class PublicSocialRow
{
    public Guid Id { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int PlayersPerCourt { get; init; }
    public int? MaxCourts { get; init; }
    public int WaitlistCount { get; init; }
    public int BlockedCourts { get; init; }
}

public sealed class FriendSeatRow
{
    public Guid SocialId { get; init; }
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
}

public sealed class FriendIncentiveRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public Guid VenueId { get; init; }
    public string TimeZone { get; init; } = "";
    public DateTime StartTime { get; init; }
    public int? PointsRedeemed { get; init; }
}

public sealed class PublicSocialSeatRow
{
    public Guid SocialId { get; init; }
    public Guid UserId { get; init; }
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
}

public sealed class SocialCourtCountRow
{
    public Guid CourtId { get; init; }
    public int Players { get; init; }
}

public sealed class SocialCourtFillRow
{
    public Guid SocialId { get; init; }
    public int CourtNumber { get; init; }
    public int Players { get; init; }
    public int PlayersPerCourt { get; init; }
    public int? MaxCourts { get; init; }
    public bool Blocked { get; init; }
}

public sealed class SocialRoomRow
{
    public Guid VenueId { get; init; }
    public int PlayersPerCourt { get; init; }
    public int? MaxCourts { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class SocialSeatRow
{
    public Guid Id { get; init; }
    public Guid CourtId { get; init; }
    public DateTime CreatedAt { get; init; }
}

public sealed class SocialMineRow
{
    public Guid SocialId { get; init; }
    public string Status { get; init; } = "";
}

public sealed class SocialAccountRow
{
    public string Email { get; init; } = "";
    public string? StripeCustomerId { get; init; }
    public int RewardPoints { get; init; }
    public int PointsPerDollar { get; init; } = 100;
    public string TimeZone { get; init; } = "Australia/Melbourne";
}

public sealed class SocialHoldRow
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public decimal Amount { get; init; }
    public decimal SubtotalAmount { get; init; }
    public decimal DiscountAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public decimal PointsValue { get; init; }
    public Guid? PromotionCodeId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string? StripePaymentIntentId { get; init; }
    public DateTime? HoldExpiresAt { get; init; }
}

public sealed class SocialCheckoutHold
{
    public string? Error { get; init; }
    public int StatusCode { get; init; }
    public Guid RegistrationId { get; init; }
    public string Status { get; init; } = "";
    public string? ExistingIntentId { get; init; }
    public decimal Amount { get; init; }
    public decimal Subtotal { get; init; }
    public decimal DiscountAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public decimal PointsValue { get; init; }
    public int IncentivePoints { get; init; }
    public string Currency { get; init; } = "AUD";
    public string Email { get; init; } = "";
    public string? StripeCustomerId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public bool AlreadyJoined { get; init; }
    public bool NeedsPayment { get; init; } = true;
    public bool Requoted { get; init; }
    public Guid? CheckoutGroupId { get; init; }
    public int FriendCount { get; init; }
    public bool Waitlist { get; init; }

    public static SocialCheckoutHold Fail(string error, int statusCode) => new() { Error = error, StatusCode = statusCode };
}

public sealed class CourtPointAwardRow
{
    public Guid BookingId { get; init; }
    public Guid UserId { get; init; }
    public Guid VenueId { get; init; }
    public Guid CourtSessionId { get; init; }
    public Guid SessionIncentiveId { get; init; }
    public int Points { get; init; }
}

public sealed class SocialPointRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public int PointsRedeemed { get; init; }
}

public sealed class WeeklySocialRow
{
    public Guid Id { get; init; }
    public Guid VenueId { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int PlayersPerCourt { get; init; }
    public int? MaxCourts { get; init; }
    public string TimeZone { get; init; } = "";
}

public sealed class OpenSocialRow
{
    public Guid Id { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int PlayersPerCourt { get; init; }
    public int? MaxCourts { get; init; }
    public bool RepeatWeekly { get; init; }
    public int PlayerCount { get; init; }
    public int WaitlistCount { get; init; }
    public int BlockedCourts { get; init; }
}

public sealed class StaleSocialHoldRow
{
    public Guid Id { get; init; }
    public Guid SocialId { get; init; }
    public int PointsRedeemed { get; init; }
    public Guid? PromotionCodeId { get; init; }
    public Guid? CheckoutGroupId { get; init; }
    public string? StripePaymentIntentId { get; init; }
}

public sealed class SocialPromoRow
{
    public Guid Id { get; init; }
    public string DiscountType { get; init; } = "";
    public decimal DiscountValue { get; init; }
}

public sealed class SocialPaymentStateRow
{
    public Guid RegistrationId { get; init; }
    public string Status { get; init; } = "";
    public Guid PaymentId { get; init; }
    public string PaymentStatus { get; init; } = "";
    public decimal Amount { get; init; }
}

public sealed record SocialPaymentTransition(string Action, Guid RegistrationId, decimal Amount, string PaymentStatus);

public sealed class CancelLockRow
{
    public Guid SocialId { get; init; }
    public string Status { get; init; } = "";
    public int PointsRedeemed { get; init; }
}

public sealed class StartedWaitlistRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public int PointsRedeemed { get; init; }
    public decimal Amount { get; init; }
    public Guid? PaymentId { get; init; }
    public string? StripePaymentIntentId { get; init; }
    public string? PaymentStatus { get; init; }
}

public sealed class SocialStatusRow
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public decimal Amount { get; init; }
    public int PointsRedeemed { get; init; }
    public int IncentivePoints { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string? PaymentStatus { get; init; }
    public string? StripePaymentIntentId { get; init; }
}

public sealed class SocialCancelContext
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public DateTime StartTime { get; init; }
    public string Currency { get; init; } = "AUD";
    public decimal LateCancelFeePercent { get; init; }
    public Guid? PaymentId { get; init; }
    public string? StripePaymentIntentId { get; init; }
    public string? PaymentStatus { get; init; }
    public decimal PaymentAmount { get; init; }
}

public sealed record SocialCancelWrite(
    Guid Id,
    Guid UserId,
    decimal FeePercent,
    Guid? PaymentId,
    string? PaymentStatus,
    string? StripeRefundId,
    decimal RefundAmount,
    string RefundStatus);

public sealed class PromotionRow
{
    public Guid Id { get; init; }
    public string Code { get; init; } = "";
    public string DiscountType { get; init; } = "";
    public decimal DiscountValue { get; init; }
    public Guid? VenueId { get; init; }
    public DateTime ValidFrom { get; init; }
    public DateTime ValidTo { get; init; }
}

public sealed class FriendPaymentStateRow
{
    public Guid PaymentId { get; init; }
    public string PaymentStatus { get; init; } = "";
    public decimal Amount { get; init; }
    public Guid? FriendGroupId { get; init; }
}

public sealed class FriendCancelContext
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public decimal ShareAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public Guid CheckoutGroupId { get; init; }
    public DateTime StartTime { get; init; }
    public string Currency { get; init; } = "AUD";
    public decimal LateCancelFeePercent { get; init; }
    public Guid? PaymentId { get; init; }
    public string? StripePaymentIntentId { get; init; }
    public string? PaymentStatus { get; init; }
    public decimal ChargedAmount { get; init; }
}

public sealed class FriendPointRow
{
    public int PointsRedeemed { get; init; }
    public Guid CheckoutGroupId { get; init; }
    public string Status { get; init; } = "";
    public decimal ChargedAmount { get; init; }
}

public sealed class WaitlistCandidateRow
{
    public Guid Id { get; init; }
    public DateTime CreatedAt { get; init; }
}

public sealed class FriendListRow
{
    public Guid Id { get; init; }
    public string DisplayName { get; init; } = "";
    public string Status { get; init; } = "";
    public decimal Amount { get; init; }
    public Guid CheckoutGroupId { get; init; }
    public string CourtName { get; init; } = "";
    public DateTime StartTime { get; init; }
}

public sealed class FriendBookingRow
{
    public Guid Id { get; init; }
    public Guid RegistrationId { get; init; }
    public string DisplayName { get; init; } = "";
    public string Status { get; init; } = "";
    public decimal Amount { get; init; }
    public DateTime StartTime { get; init; }
    public string CourtName { get; init; } = "";
}

public sealed class SocialRosterNameRow
{
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string Name { get; init; } = "";
}

public sealed class FriendSpotRow
{
    public Guid Id { get; init; }
    public string DisplayName { get; init; } = "";
    public string Status { get; init; } = "";
    public decimal Amount { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string VenueName { get; init; } = "";
    public string VenueSlug { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string Currency { get; init; } = "";
    public Guid SocialId { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public string RegistrationStatus { get; init; } = "";
    public decimal SubtotalAmount { get; init; }
    public decimal DiscountAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public DateTime AddedAt { get; init; }
    public DateTime? CancelledAt { get; init; }
    public decimal CancelFeePercent { get; init; }
    public decimal LateFeePercent { get; init; }
    public bool WasPaid { get; init; }
    public long PointsEarned { get; init; }
}

public sealed class FriendGroupIntentRow
{
    public Guid GroupId { get; init; }
    public string? StripePaymentIntentId { get; init; }
}

public sealed class PendingFriendReleaseRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public int PointsRedeemed { get; init; }
    public Guid? PromotionCodeId { get; init; }
}

public sealed class BookingListRow
{
    public Guid Id { get; init; }
    public string VenueName { get; init; } = "";
    public string VenueSlug { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string Currency { get; init; } = "";
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public string Status { get; init; } = "";
    public decimal TotalAmount { get; init; }
    public Guid? GroupId { get; init; }
    public Guid? SocialId { get; init; }
    public decimal SubtotalAmount { get; init; }
    public decimal DiscountAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public DateTime BookedAt { get; init; }
    public DateTime? CancelledAt { get; init; }
    public bool WasPaid { get; init; }
    public decimal CancelFeePercent { get; init; }
    public decimal LateFeePercent { get; init; }
    public long PointsEarned { get; init; }
}

public sealed class CancelBookingRow
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public Guid UserId { get; init; }
    public DateTime StartTime { get; init; }
    public string Currency { get; init; } = "AUD";
}

public sealed class PendingRewardRow
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public int Points { get; init; }
    public string VenueName { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string CourtName { get; init; } = "";
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public int CourtCount { get; init; } = 1;
    public int CancelledCourts { get; init; }
    public string? CancelledCourtNames { get; init; }
}

public sealed class RewardAwardRow
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public int Points { get; init; }
    public DateTime AwardedAt { get; init; }
    public string VenueName { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string CourtName { get; init; } = "";
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public int CourtCount { get; init; } = 1;
    public int CancelledCourts { get; init; }
    public string? CancelledCourtNames { get; init; }
}

public sealed class PaymentListRow
{
    public Guid Id { get; init; }
    public string Kind { get; init; } = "";
    public decimal Amount { get; init; }
    public string Currency { get; init; } = "";
    public string Status { get; init; } = "";
    public DateTime OccurredAt { get; init; }
    public string VenueName { get; init; } = "";
    public string Source { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string? CourtNames { get; init; }
    public long CourtCount { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal RefundedAmount { get; init; }
}
