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
                     v.LateCancelFeePercent, v.PointsPerDollar, v.HourlyRate
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
        var filter = status switch
        {
            "past" => "(b.Status IN ('completed', 'no_show') OR (b.Status = 'confirmed' AND cs.StartTime <= UTC_TIMESTAMP(6)))",
            "cancelled" => "b.Status IN ('cancelled', 'expired')",
            _ => "b.Status IN ('pending', 'confirmed') AND cs.StartTime > UTC_TIMESTAMP(6)",
        };
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                $"""
                SELECT COUNT(*)
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
                WHERE b.UserId = @UserId AND b.IsDeleted = 0 AND {filter}
                """,
                new { UserId = userId },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<BookingListRow>(
            new CommandDefinition(
                $"""
                SELECT b.Id, v.Name AS VenueName, v.Slug AS VenueSlug, v.TimeZone, v.Currency,
                       c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime, b.Status, b.TotalAmount
                FROM Bookings b
                JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.VenueId = b.VenueId
                JOIN Courts c ON c.Id = cs.CourtId
                JOIN Venues v ON v.Id = b.VenueId
                WHERE b.UserId = @UserId AND b.IsDeleted = 0 AND {filter}
                ORDER BY cs.StartTime DESC
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
        var total = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM RewardPointAwards WHERE UserId = @UserId",
                new { UserId = userId },
                cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<RewardAwardRow>(
            new CommandDefinition(
                """
                SELECT a.Id, a.Points, a.AwardedAt, v.Name AS VenueName, v.TimeZone,
                       c.CourtName, cs.StartTime, cs.EndTime
                FROM RewardPointAwards a
                JOIN Venues v ON v.Id = a.VenueId
                JOIN CourtSessions cs ON cs.Id = a.CourtSessionId
                JOIN Courts c ON c.Id = cs.CourtId
                WHERE a.UserId = @UserId
                ORDER BY a.AwardedAt DESC
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

    private static bool SameInstant(DateTime left, DateTime right) =>
        Math.Abs(left.Ticks - right.Ticks) < TimeSpan.TicksPerSecond;

    private const string VenueColumns = """
        Id, Name, Slug, Description, Address, Suburb, State, Postcode, Country,
        Latitude, Longitude, Phone, Email, ImageUrl, TimeZone, Currency,
        LateCancelFeePercent, PointsPerDollar, HourlyRate
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
