using Dapper;
using MySqlConnector;

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
            SELECT b.Id AS BookingId, c.Id AS CourtId, cs.StartTime, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId AND cs.IsDeleted = 0
            JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId AND c.IsActive = 1 AND c.IsDeleted = 0
            WHERE b.VenueId = @VenueId
              AND b.IsDeleted = 0
              AND b.Status = 'confirmed'
              AND cs.StartTime < @DayEndUtc
              AND cs.EndTime > @DayStartUtc
              AND (
                    EXISTS (
                        SELECT 1 FROM Payments p
                        WHERE p.BookingId = b.Id AND p.Status = 'succeeded'
                    )
                    OR NOT EXISTS (
                        SELECT 1 FROM Payments p
                        WHERE p.BookingId = b.Id
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

        if (overlaps.Length > 0)
        {
            return (Guid.Empty, 0, "This slot is not available.");
        }

        if (hourlyRate <= 0)
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

        if (hourlyRate <= 0)
        {
            return (Guid.Empty, 0, "This venue has not set an hourly rate yet.");
        }

        var minutes = (decimal)(endUtc - startUtc).TotalMinutes;
        var price = decimal.Round(hourlyRate * minutes / 60m, 2, MidpointRounding.AwayFromZero);
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
                SELECT Id, Code, DiscountType, DiscountValue, VenueId
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
        CancellationToken cancellationToken)
    {
        await AwardEndedSocialIncentivesAsync(cancellationToken);
        var filter = status switch
        {
            "past" => "(b.Status IN ('completed', 'no_show') OR (b.Status = 'confirmed' AND cs.StartTime <= UTC_TIMESTAMP(6)))",
            "cancelled" => "b.Status IN ('cancelled', 'expired')",
            _ => "b.Status IN ('pending', 'confirmed') AND cs.StartTime > UTC_TIMESTAMP(6)",
        };
        var socialFilter = status switch
        {
            "past" => "r.Status = 'confirmed' AND s.EndTime <= UTC_TIMESTAMP(6)",
            "cancelled" => "r.Status IN ('cancelled', 'expired')",
            _ => "(r.Status = 'confirmed' OR (r.Status = 'pending' AND r.HoldExpiresAt > UTC_TIMESTAMP(6))) AND s.EndTime > UTC_TIMESTAMP(6)",
        };
        const string listed = """
            SELECT b.Id, v.Name AS VenueName, v.Slug AS VenueSlug, v.TimeZone, v.Currency,
                   c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime, b.Status, b.TotalAmount
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.IsDeleted = 0 AND {0}
            UNION ALL
            SELECT r.Id, v.Name, v.Slug, v.TimeZone, v.Currency,
                   'Drop-in social', c.CourtNumber, s.StartTime, s.EndTime, r.Status, r.Amount
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Courts c ON c.Id = r.CourtId
            JOIN Venues v ON v.Id = r.VenueId
            WHERE r.UserId = @UserId AND {1}
            """;
        var combined = string.Format(listed, filter, socialFilter);
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                $"SELECT COUNT(*) FROM ({combined}) entries",
                new { UserId = userId },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<BookingListRow>(
            new CommandDefinition(
                $"""
                SELECT Id, VenueName, VenueSlug, TimeZone, Currency, CourtName, CourtNumber, StartTime, EndTime, Status, TotalAmount
                FROM ({combined}) entries
                ORDER BY StartTime DESC
                LIMIT @Take OFFSET @Skip
                """,
                new { UserId = userId, Take = pageSize, Skip = offset },
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

    public async Task<(RewardAwardRow[] Items, int Total)> ListRewardsAsync(
        Guid userId,
        int offset,
        int pageSize,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        const string awards = """
            SELECT a.Id, a.Points, a.AwardedAt, v.Name AS VenueName, v.TimeZone,
                   c.CourtName, cs.StartTime, cs.EndTime
            FROM RewardPointAwards a
            JOIN Venues v ON v.Id = a.VenueId
            JOIN CourtSessions cs ON cs.Id = a.CourtSessionId
            JOIN Courts c ON c.Id = cs.CourtId
            WHERE a.UserId = @UserId
            UNION ALL
            SELECT r.Id, r.IncentivePoints, r.IncentiveAwardedAt, v.Name, v.TimeZone,
                   'Drop-in social', s.StartTime, s.EndTime
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            JOIN Venues v ON v.Id = r.VenueId
            WHERE r.UserId = @UserId AND r.IncentiveAwardedAt IS NOT NULL AND r.IncentivePoints > 0
            """;
        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                $"SELECT COUNT(*) FROM ({awards}) awards",
                new { UserId = userId },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<RewardAwardRow>(
            new CommandDefinition(
                $"""
                SELECT Id, Points, AwardedAt, VenueName, TimeZone, CourtName, StartTime, EndTime
                FROM ({awards}) awards
                ORDER BY AwardedAt DESC
                LIMIT @Take OFFSET @Skip
                """,
                new { UserId = userId, Take = pageSize, Skip = offset },
                cancellationToken: cancellationToken));
        return (rows.ToArray(), total);
    }

    public async Task<(PaymentListRow[] Items, int Total)> ListPaymentsAsync(
        Guid userId,
        int offset,
        int pageSize,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        const string union = """
            SELECT p.Id, 'payment' AS Kind, p.Amount, p.Currency, p.Status, COALESCE(p.PaidAt, p.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName
            FROM Payments p
            JOIN Bookings b ON b.Id = p.BookingId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId
            UNION ALL
            SELECT r.Id, 'refund' AS Kind, r.Amount, p.Currency, r.Status, COALESCE(r.ProcessedAt, r.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName
            FROM Refunds r
            JOIN Payments p ON p.Id = r.PaymentId
            JOIN Bookings b ON b.Id = p.BookingId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId
            UNION ALL
            SELECT p.Id, 'payment' AS Kind, p.Amount, p.Currency, p.Status, COALESCE(p.PaidAt, p.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName
            FROM PublicSocialPayments p
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            JOIN Venues v ON v.Id = r.VenueId
            WHERE r.UserId = @UserId
            UNION ALL
            SELECT sr.Id, 'refund' AS Kind, sr.Amount, p.Currency, sr.Status, COALESCE(sr.ProcessedAt, sr.CreatedAt) AS OccurredAt,
                   v.Name AS VenueName
            FROM PublicSocialRefunds sr
            JOIN PublicSocialPayments p ON p.Id = sr.PaymentId
            JOIN PublicSocialRegistrations r ON r.Id = p.RegistrationId
            JOIN Venues v ON v.Id = r.VenueId
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
                SELECT Id, Kind, Amount, Currency, Status, OccurredAt, VenueName
                FROM ({union}) entries
                ORDER BY OccurredAt DESC
                LIMIT @Take OFFSET @Skip
                """,
                new { UserId = userId, Take = pageSize, Skip = offset },
                cancellationToken: cancellationToken));
        return (rows.ToArray(), total);
    }

    public const int PublicSocialCapacity = 8;

    public async Task<PublicSocialRow?> FindPublicSocialAsync(Guid venueId, Guid socialId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<PublicSocialRow>(new CommandDefinition(
            """
            SELECT Id, StartTime, EndTime, Price
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
            SELECT Id, StartTime, EndTime, Price
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
        var rows = await connection.QueryAsync<PublicSocialSeatRow>(new CommandDefinition(
            """
            SELECT r.SocialId, r.UserId, c.Id AS CourtId, c.CourtName, c.CourtNumber
            FROM PublicSocialRegistrations r
            JOIN Courts c ON c.Id = r.CourtId
            WHERE r.SocialId IN @SocialIds AND r.Status = 'confirmed'
            """,
            new { SocialIds = socialIds },
            cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task ExpirePublicSocialHoldsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<SocialPointRow>(new CommandDefinition(
            """
            SELECT Id, UserId, PointsRedeemed
            FROM PublicSocialRegistrations
            WHERE Status = 'pending'
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
                WHERE Status = 'pending' AND RegistrationId IN @Ids
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

        await tx.CommitAsync(cancellationToken);
    }

    public async Task AwardEndedSocialIncentivesAsync(CancellationToken cancellationToken)
    {
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

        await tx.CommitAsync(cancellationToken);
        await RollWeeklySocialsAsync(cancellationToken);
    }

    public async Task RollWeeklySocialsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var due = (await connection.QueryAsync<WeeklySocialRow>(new CommandDefinition(
            """
            SELECT s.Id, s.VenueId, s.StartTime, s.EndTime, s.Price, v.TimeZone
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
                        (Id, VenueId, StartTime, EndTime, Price, RepeatWeekly, IsDeleted, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @StartTime, @EndTime, @Price, 1, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    new { Id = successorId, row.VenueId, StartTime = nextStart, EndTime = nextEnd, row.Price },
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
            SELECT s.Id, s.StartTime, s.EndTime, s.Price, s.RepeatWeekly, COUNT(r.Id) AS PlayerCount
            FROM PublicSocials s
            LEFT JOIN PublicSocialRegistrations r ON r.SocialId = s.Id AND r.Status = 'confirmed'
            WHERE s.VenueId = @VenueId AND s.IsDeleted = 0
              AND s.StartTime > UTC_TIMESTAMP(6)
            GROUP BY s.Id, s.StartTime, s.EndTime, s.Price, s.RepeatWeekly
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
            SELECT Id, StartTime, EndTime, Price
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
                   r.PromotionCodeId, c.CourtName, c.CourtNumber,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM PublicSocialPayments p
                       WHERE p.RegistrationId = r.Id AND p.Status IN ('pending', 'succeeded')
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
            FROM PublicSocialRegistrations
            WHERE SocialId = @SocialId
              AND (
                  Status = 'confirmed'
                  OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
              )
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
        var court = courts.FirstOrDefault(item => counts.GetValueOrDefault(item.Id) < PublicSocialCapacity);
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
            SELECT Id, StartTime, EndTime, Price
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
                       WHERE p.RegistrationId = r.Id AND p.Status = 'pending'
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
                WHERE Status = 'pending' AND RegistrationId IN @Ids
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
                FROM PublicSocialRegistrations
                WHERE SocialId = @SocialId
                  AND (
                      Status = 'confirmed'
                      OR (Status = 'pending' AND HoldExpiresAt > UTC_TIMESTAMP(6))
                  )
                GROUP BY CourtId
                """,
                new { SocialId = social.Id },
                tx,
                cancellationToken: cancellationToken))).ToDictionary(row => row.CourtId, row => row.Players);
            var court = courts.FirstOrDefault(item => counts.GetValueOrDefault(item.Id) < PublicSocialCapacity);
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
                WHERE Status = 'pending' AND RegistrationId IN @Ids
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
            WHERE p.StripePaymentIntentId = @IntentId
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
            "expired" or "cancelled" => "refund",
            _ => "already",
        };
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
            WHERE p.StripePaymentIntentId = @IntentId AND r.Status = 'pending'
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
            WHERE p.StripePaymentIntentId = @IntentId AND sibling.Status = 'pending' AND owner.CheckoutGroupId IS NOT NULL
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
            WHERE p.StripePaymentIntentId = @IntentId AND p.Status = 'pending' AND r.Status = 'pending'
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
            WHERE Id = @Id AND Status = 'pending'
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
            WHERE Id = @Id AND Status = 'pending'
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
            WHERE RegistrationId = @Id AND Status = 'pending'
            """,
            new { Id = registrationId },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations
            SET Status = 'expired', CancelledAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND Status = 'pending'
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
            SELECT r.Id, r.Status, r.Amount, r.PointsRedeemed, COALESCE(r.IncentivePoints, 0) AS IncentivePoints, c.CourtName, c.CourtNumber, p.Status AS PaymentStatus, p.StripePaymentIntentId
            FROM PublicSocialRegistrations r
            JOIN Courts c ON c.Id = r.CourtId
            LEFT JOIN PublicSocialPayments p ON p.Id = (
                SELECT p2.Id FROM PublicSocialPayments p2
                WHERE p2.RegistrationId = r.Id
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
                WHERE owner.Id = r.Id
                   OR (r.CheckoutGroupId IS NOT NULL AND owner.CheckoutGroupId = r.CheckoutGroupId)
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
        var heldPoints = await connection.ExecuteScalarAsync<int?>(new CommandDefinition(
            """
            SELECT r.PointsRedeemed
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            WHERE r.Id = @Id AND r.UserId = @UserId
              AND r.Status IN ('pending', 'confirmed')
              AND s.StartTime > UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            write,
            tx,
            cancellationToken: cancellationToken));
        if (heldPoints is null)
        {
            return false;
        }

        var restore = write.FeePercent <= 0
            ? heldPoints.Value
            : (int)Math.Floor(heldPoints.Value * (100m - write.FeePercent) / 100m);
        await RestoreSocialPointsAsync(connection, tx, write.UserId, restore, cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            SET r.Status = 'cancelled',
                r.CancelledAt = UTC_TIMESTAMP(6),
                r.CancelFeePercent = @FeePercent
            WHERE r.Id = @Id AND r.UserId = @UserId
              AND r.Status IN ('pending', 'confirmed')
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

    private static bool SameInstant(DateTime left, DateTime right) =>
        Math.Abs(left.Ticks - right.Ticks) < TimeSpan.TicksPerSecond;

    private const string VenueColumns = """
        Id, Name, Slug, Description, Address, Suburb, State, Postcode, Country,
        Latitude, Longitude, Phone, Email, ImageUrl, TimeZone, Currency,
        LateCancelFeePercent, PointsPerDollar, HourlyRate, SocialPrice
        """;
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
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
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

    public static SocialCheckoutHold Fail(string error, int statusCode) => new() { Error = error, StatusCode = statusCode };
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
    public string TimeZone { get; init; } = "";
}

public sealed class OpenSocialRow
{
    public Guid Id { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public bool RepeatWeekly { get; init; }
    public int PlayerCount { get; init; }
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
}

public sealed class CancelBookingRow
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public Guid UserId { get; init; }
    public DateTime StartTime { get; init; }
    public string Currency { get; init; } = "AUD";
}

public sealed class RewardAwardRow
{
    public Guid Id { get; init; }
    public int Points { get; init; }
    public DateTime AwardedAt { get; init; }
    public string VenueName { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string CourtName { get; init; } = "";
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
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
}
