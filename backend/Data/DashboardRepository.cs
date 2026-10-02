using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using MySqlConnector;

namespace ShuttleSync.Api.Data;

public sealed class DashboardRepository(IConfiguration configuration)
{
    public async Task<bool> CanAccessVenueAsync(Guid userId, string role, Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var found = await connection.ExecuteScalarAsync<int>(
            new CommandDefinition(
                """
                SELECT COUNT(*)
                FROM Venues v
                WHERE v.Id = @VenueId AND v.IsDeleted = 0
                  AND (
                    @Role = 'admin'
                    OR EXISTS (
                      SELECT 1 FROM UserVenues uv
                      WHERE uv.UserId = @UserId AND uv.VenueId = v.Id
                    )
                  )
                """,
                new { UserId = userId, Role = role, VenueId = venueId },
                cancellationToken: cancellationToken));
        return found > 0;
    }

    public async Task<DashVenueRow?> FindVenueAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<DashVenueRow>(
            new CommandDefinition(
                """
                SELECT Id, Name, Slug, Description, Address, Suburb, State, Postcode, Country,
                       Latitude, Longitude, Phone, Email, ImageUrl, TimeZone, Currency,
                       LateCancelFeePercent, PointsPerDollar, IsActive
                FROM Venues
                WHERE Id = @Id AND IsDeleted = 0
                """,
                new { Id = venueId },
                cancellationToken: cancellationToken));
    }

    public async Task<string?> CreateVenueAsync(DashVenueWrite write, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO Venues
                    (Id, Name, Slug, Description, Address, Suburb, State, Postcode, Country,
                     Latitude, Longitude, Phone, Email, ImageUrl, TimeZone, Currency,
                     LateCancelFeePercent, PointsPerDollar, IsActive,
                     IsDeleted, CreatedAt, UpdatedAt)
                VALUES
                    (@Id, @Name, @Slug, @Description, @Address, @Suburb, @State, @Postcode, @Country,
                     @Latitude, @Longitude, @Phone, @Email, @ImageUrl, @TimeZone, @Currency,
                     @LateCancelFeePercent, @PointsPerDollar, @IsActive,
                     0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                """,
                write with { Id = id }, tx, cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return "That venue slug is already in use.";
        }

        await AuditAsync(connection, tx, actorId, id, "create", "Venue", id, write, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> UpdateVenueAsync(DashVenueWrite write, bool adminFields, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var sql = adminFields
            ? """
              UPDATE Venues
              SET Name = @Name, Slug = @Slug, Description = @Description, Address = @Address,
                  Suburb = @Suburb, State = @State, Postcode = @Postcode, Country = @Country,
                  Latitude = @Latitude, Longitude = @Longitude, Phone = @Phone, Email = @Email,
                  ImageUrl = @ImageUrl, TimeZone = @TimeZone, Currency = @Currency,
                  LateCancelFeePercent = @LateCancelFeePercent, PointsPerDollar = @PointsPerDollar,
                  IsActive = @IsActive,
                  UpdatedAt = UTC_TIMESTAMP(6)
              WHERE Id = @Id AND IsDeleted = 0
              """
            : """
              UPDATE Venues
              SET Description = @Description, Address = @Address, Suburb = @Suburb, State = @State,
                  Postcode = @Postcode, Phone = @Phone, Email = @Email, ImageUrl = @ImageUrl,
                  UpdatedAt = UTC_TIMESTAMP(6)
              WHERE Id = @Id AND IsDeleted = 0
              """;
        try
        {
            var changed = await connection.ExecuteAsync(new CommandDefinition(sql, write, tx, cancellationToken: cancellationToken));
            if (changed == 0)
            {
                return "That venue was not found.";
            }
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return "That venue slug is already in use.";
        }

        await AuditAsync(connection, tx, actorId, write.Id, "update", "Venue", write.Id, write, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> SoftDeleteVenueAsync(Guid venueId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Venues
            SET IsDeleted = 1, DeletedAt = UTC_TIMESTAMP(6), IsActive = 0, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND IsDeleted = 0
            """,
            new { Id = venueId }, tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That venue was not found.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "delete", "Venue", venueId, new { venueId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashCourtRow[]> ListCourtsAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashCourtRow>(new CommandDefinition(
            """
            SELECT Id, VenueId, CourtName, CourtNumber, Description, SurfaceType, ImageUrl, IsActive
            FROM Courts
            WHERE VenueId = @VenueId AND IsDeleted = 0
            ORDER BY CourtNumber
            """,
            new { VenueId = venueId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<string?> SaveCourtAsync(DashCourtWrite write, bool creating, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            if (creating)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO Courts
                        (Id, VenueId, CourtName, CourtNumber, Description, SurfaceType, ImageUrl, IsActive, IsDeleted, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @CourtName, @CourtNumber, @Description, @SurfaceType, @ImageUrl, @IsActive, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    write, tx, cancellationToken: cancellationToken));
            }
            else
            {
                var changed = await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE Courts
                    SET CourtName = @CourtName, CourtNumber = @CourtNumber, Description = @Description,
                        SurfaceType = @SurfaceType, ImageUrl = @ImageUrl, IsActive = @IsActive, UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
                    """,
                    write, tx, cancellationToken: cancellationToken));
                if (changed == 0)
                {
                    return "That court was not found.";
                }
            }
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return "That court number is already used at this venue.";
        }

        await AuditAsync(connection, tx, actorId, write.VenueId, creating ? "create" : "update", "Court", write.Id, write, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> SoftDeleteCourtAsync(Guid venueId, Guid courtId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var future = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM CourtSessions
            WHERE CourtId = @CourtId AND VenueId = @VenueId AND IsDeleted = 0 AND EndTime > UTC_TIMESTAMP(6)
            """,
            new { CourtId = courtId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (future > 0)
        {
            return "Remove future slots before deleting this court.";
        }

        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Courts
            SET IsDeleted = 1, DeletedAt = UTC_TIMESTAMP(6), IsActive = 0, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @CourtId AND VenueId = @VenueId AND IsDeleted = 0
            """,
            new { CourtId = courtId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That court was not found.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "delete", "Court", courtId, new { courtId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashSessionRow[]> ListSessionsAsync(Guid venueId, DateTime startUtc, DateTime endUtc, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashSessionRow>(new CommandDefinition(
            """
            SELECT cs.Id, cs.CourtId, c.CourtName, c.CourtNumber, cs.StartTime, cs.EndTime, cs.Price,
                   si.Points AS IncentivePoints, si.IsActive AS IncentiveActive
            FROM CourtSessions cs
            JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId
            LEFT JOIN SessionIncentives si ON si.CourtSessionId = cs.Id
            WHERE cs.VenueId = @VenueId AND cs.IsDeleted = 0
              AND cs.StartTime < @EndUtc AND cs.EndTime > @StartUtc
            ORDER BY c.CourtNumber, cs.StartTime
            """,
            new { VenueId = venueId, StartUtc = startUtc, EndUtc = endUtc }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<string?> CreateSessionsAsync(
        Guid venueId,
        Guid courtId,
        IReadOnlyList<(DateTime Start, DateTime End, decimal Price)> slots,
        DateOnly localDay,
        Guid actorId,
        string? ip,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var court = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM Courts
            WHERE Id = @CourtId AND VenueId = @VenueId AND IsDeleted = 0
            FOR UPDATE
            """,
            new { CourtId = courtId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (court == 0)
        {
            return "That court was not found.";
        }

        foreach (var slot in slots)
        {
            var overlap = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*) FROM CourtSessions
                WHERE CourtId = @CourtId AND IsDeleted = 0
                  AND StartTime < @EndTime AND EndTime > @StartTime
                """,
                new { CourtId = courtId, StartTime = slot.Start, EndTime = slot.End }, tx, cancellationToken: cancellationToken));
            if (overlap > 0)
            {
                return "That time overlaps another slot on this court.";
            }

            var id = Guid.NewGuid();
            try
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO CourtSessions
                        (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    new { Id = id, VenueId = venueId, CourtId = courtId, StartTime = slot.Start, EndTime = slot.End, slot.Price },
                    tx, cancellationToken: cancellationToken));
            }
            catch (MySqlException exception) when (exception.Number == 1062)
            {
                return "That start time is already used on this court.";
            }

            await SyncSessionIncentiveAsync(connection, tx, venueId, id, localDay, actorId, cancellationToken);
            await AuditAsync(connection, tx, actorId, venueId, "create", "CourtSession", id, slot, ip, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> UpdateSessionAsync(
        Guid venueId,
        Guid sessionId,
        Guid courtId,
        DateTime start,
        DateTime end,
        decimal price,
        DateOnly localDay,
        Guid actorId,
        string? ip,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var court = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM Courts
            WHERE Id = @CourtId AND VenueId = @VenueId AND IsDeleted = 0
            FOR UPDATE
            """,
            new { CourtId = courtId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (court == 0)
        {
            return "That court was not found.";
        }

        var exists = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM CourtSessions WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0",
            new { Id = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (exists == 0)
        {
            return "That slot was not found.";
        }

        var overlap = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM CourtSessions
            WHERE CourtId = @CourtId AND IsDeleted = 0 AND Id <> @Id
              AND StartTime < @EndTime AND EndTime > @StartTime
            """,
            new { CourtId = courtId, Id = sessionId, StartTime = start, EndTime = end }, tx, cancellationToken: cancellationToken));
        if (overlap > 0)
        {
            return "That time overlaps another slot on this court.";
        }

        var discount = await connection.ExecuteScalarAsync<decimal>(new CommandDefinition(
            """
            SELECT COALESCE(MAX(DiscountAmount + PointsValue), 0) FROM Bookings
            WHERE CourtSessionId = @Id AND VenueId = @VenueId AND IsDeleted = 0 AND Status = 'confirmed'
            """,
            new { Id = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (discount > price)
        {
            return "The price is lower than the discount already applied.";
        }

        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE CourtSessions
                SET CourtId = @CourtId, StartTime = @StartTime, EndTime = @EndTime, Price = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
                """,
                new { Id = sessionId, VenueId = venueId, CourtId = courtId, StartTime = start, EndTime = end, Price = price },
                tx, cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return "That start time is already used on this court.";
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET SubtotalAmount = @Price, TotalAmount = @Price - DiscountAmount - PointsValue, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE CourtSessionId = @Id AND VenueId = @VenueId AND IsDeleted = 0 AND Status = 'confirmed'
            """,
            new { Id = sessionId, VenueId = venueId, Price = price }, tx, cancellationToken: cancellationToken));
        await SyncSessionIncentiveAsync(connection, tx, venueId, sessionId, localDay, actorId, cancellationToken);
        await AuditAsync(connection, tx, actorId, venueId, "update", "CourtSession", sessionId, new { courtId, start, end, price }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> SoftDeleteSessionAsync(Guid venueId, Guid sessionId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET Status = 'cancelled', CancelledAt = UTC_TIMESTAMP(6), CancelledBy = @ActorId,
                CancelReason = 'removed by staff', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE CourtSessionId = @Id AND VenueId = @VenueId AND IsDeleted = 0
              AND Status IN ('pending', 'confirmed')
            """,
            new { Id = sessionId, VenueId = venueId, ActorId = actorId }, tx, cancellationToken: cancellationToken));

        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE CourtSessions
            SET IsDeleted = 1, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0
            """,
            new { Id = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That slot was not found.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "delete", "CourtSession", sessionId, new { sessionId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> SaveIncentiveAsync(Guid venueId, Guid sessionId, int points, bool active, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var session = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM CourtSessions WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0",
            new { Id = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (session == 0)
        {
            return "That slot was not found.";
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO SessionIncentives
                (Id, VenueId, CourtSessionId, Points, IsActive, CreatedBy, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @VenueId, @SessionId, @Points, @Active, @ActorId, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            ON DUPLICATE KEY UPDATE
                Points = VALUES(Points), IsActive = VALUES(IsActive), UpdatedAt = UTC_TIMESTAMP(6)
            """,
            new { Id = Guid.NewGuid(), VenueId = venueId, SessionId = sessionId, Points = points, Active = active, ActorId = actorId },
            tx, cancellationToken: cancellationToken));
        await AuditAsync(connection, tx, actorId, venueId, "update", "SessionIncentive", sessionId, new { points, active }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> DeleteIncentiveAsync(Guid venueId, Guid sessionId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var awarded = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM RewardPointAwards a
            JOIN SessionIncentives si ON si.Id = a.SessionIncentiveId
            WHERE si.CourtSessionId = @SessionId AND si.VenueId = @VenueId
            """,
            new { SessionId = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (awarded > 0)
        {
            return "Points were already awarded for this booking.";
        }

        var changed = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM SessionIncentives WHERE CourtSessionId = @SessionId AND VenueId = @VenueId",
            new { SessionId = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "There is no incentive on this slot.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "delete", "SessionIncentive", sessionId, new { sessionId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashVenueIncentiveRow[]> ListVenueIncentivesAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashVenueIncentiveRow>(new CommandDefinition(
            """
            SELECT Id, Points, StartsOn, EndsOn, IsActive
            FROM VenueIncentives
            WHERE VenueId = @VenueId
            ORDER BY StartsOn DESC, EndsOn DESC
            """,
            new { VenueId = venueId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<string?> SaveVenueIncentiveAsync(Guid venueId, Guid? incentiveId, DateOnly startsOn, DateOnly endsOn, int points, bool active, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        if (endsOn < startsOn)
        {
            return "The end date must be on or after the start date.";
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        if (active)
        {
            var overlap = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*) FROM VenueIncentives
                WHERE VenueId = @VenueId AND IsActive = 1
                  AND (@Id IS NULL OR Id <> @Id)
                  AND StartsOn <= @EndsOn AND EndsOn >= @StartsOn
                """,
                new { VenueId = venueId, Id = incentiveId, StartsOn = startsOn.ToDateTime(TimeOnly.MinValue), EndsOn = endsOn.ToDateTime(TimeOnly.MinValue) },
                tx, cancellationToken: cancellationToken));
            if (overlap > 0)
            {
                return "Those dates overlap another active incentive.";
            }
        }

        if (incentiveId is null)
        {
            var id = Guid.NewGuid();
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO VenueIncentives
                    (Id, VenueId, Points, StartsOn, EndsOn, IsActive, CreatedBy, CreatedAt, UpdatedAt)
                VALUES
                    (@Id, @VenueId, @Points, @StartsOn, @EndsOn, @Active, @ActorId, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                """,
                new { Id = id, VenueId = venueId, Points = points, StartsOn = startsOn.ToDateTime(TimeOnly.MinValue), EndsOn = endsOn.ToDateTime(TimeOnly.MinValue), Active = active, ActorId = actorId },
                tx, cancellationToken: cancellationToken));
            await AuditAsync(connection, tx, actorId, venueId, "create", "VenueIncentive", id, new { points, startsOn, endsOn, active }, ip, cancellationToken);
        }
        else
        {
            var changed = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE VenueIncentives
                SET Points = @Points, StartsOn = @StartsOn, EndsOn = @EndsOn, IsActive = @Active, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND VenueId = @VenueId
                """,
                new { Id = incentiveId, VenueId = venueId, Points = points, StartsOn = startsOn.ToDateTime(TimeOnly.MinValue), EndsOn = endsOn.ToDateTime(TimeOnly.MinValue), Active = active },
                tx, cancellationToken: cancellationToken));
            if (changed == 0)
            {
                return "That incentive was not found.";
            }

            await AuditAsync(connection, tx, actorId, venueId, "update", "VenueIncentive", incentiveId.Value, new { points, startsOn, endsOn, active }, ip, cancellationToken);
        }

        await ApplyVenueIncentivesAsync(connection, tx, venueId, actorId, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> DeleteVenueIncentiveAsync(Guid venueId, Guid incentiveId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM VenueIncentives WHERE Id = @Id AND VenueId = @VenueId",
            new { Id = incentiveId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That incentive was not found.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "delete", "VenueIncentive", incentiveId, new { incentiveId }, ip, cancellationToken);
        await ApplyVenueIncentivesAsync(connection, tx, venueId, actorId, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashClosureRow[]> ListClosuresAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashClosureRow>(new CommandDefinition(
            """
            SELECT cc.Id, cc.CourtId, c.CourtName, cc.StartTime, cc.EndTime, cc.Reason
            FROM CourtClosures cc
            LEFT JOIN Courts c ON c.Id = cc.CourtId
            WHERE cc.VenueId = @VenueId
            ORDER BY cc.StartTime DESC
            """,
            new { VenueId = venueId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<string?> CreateClosureAsync(Guid venueId, Guid? courtId, DateTime start, DateTime end, string? reason, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        if (courtId is not null)
        {
            await using var check = await OpenAsync(cancellationToken);
            var court = await check.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM Courts WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0",
                new { Id = courtId, VenueId = venueId }, cancellationToken: cancellationToken));
            if (court == 0)
            {
                return "That court was not found.";
            }
        }

        var id = Guid.NewGuid();
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO CourtClosures (Id, VenueId, CourtId, StartTime, EndTime, Reason, CreatedBy, CreatedAt)
            VALUES (@Id, @VenueId, @CourtId, @Start, @End, @Reason, @ActorId, UTC_TIMESTAMP(6))
            """,
            new { Id = id, VenueId = venueId, CourtId = courtId, Start = start, End = end, Reason = reason, ActorId = actorId },
            tx, cancellationToken: cancellationToken));
        await AuditAsync(connection, tx, actorId, venueId, "create", "CourtClosure", id, new { courtId, start, end, reason }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> UpdateClosureAsync(Guid venueId, Guid closureId, Guid? courtId, DateTime start, DateTime end, string? reason, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        if (courtId is not null)
        {
            await using var check = await OpenAsync(cancellationToken);
            var court = await check.ExecuteScalarAsync<int>(new CommandDefinition(
                "SELECT COUNT(*) FROM Courts WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0",
                new { Id = courtId, VenueId = venueId }, cancellationToken: cancellationToken));
            if (court == 0)
            {
                return "That court was not found.";
            }
        }

        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE CourtClosures
            SET CourtId = @CourtId, StartTime = @Start, EndTime = @End, Reason = @Reason
            WHERE Id = @Id AND VenueId = @VenueId
            """,
            new { Id = closureId, VenueId = venueId, CourtId = courtId, Start = start, End = end, Reason = reason },
            tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That closure was not found.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "update", "CourtClosure", closureId, new { courtId, start, end, reason }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> DeleteClosureAsync(Guid venueId, Guid closureId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM CourtClosures WHERE Id = @Id AND VenueId = @VenueId",
            new { Id = closureId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That closure was not found.";
        }

        await AuditAsync(connection, tx, actorId, venueId, "delete", "CourtClosure", closureId, new { closureId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashPage<DashPromoRow>> ListPromotionsAsync(Guid? venueId, IReadOnlyCollection<Guid> allowedVenues, bool admin, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (!admin && (allowedVenues.Count == 0 || (venueId is not null && !allowedVenues.Contains(venueId.Value))))
        {
            return new DashPage<DashPromoRow>([], pageNumber, size, 0);
        }

        await using var connection = await OpenAsync(cancellationToken);
        var where = admin
            ? "WHERE (@VenueId IS NULL OR VenueId = @VenueId OR (@VenueId IS NULL AND VenueId IS NULL))"
            : "WHERE VenueId IN @Allowed";
        if (!admin && venueId is not null)
        {
            where += " AND VenueId = @VenueId";
        }

        if (admin && venueId is not null)
        {
            where = "WHERE VenueId = @VenueId";
        }

        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM PromotionCodes {where}",
            new { VenueId = venueId, Allowed = allowedVenues }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashPromoRow>(new CommandDefinition(
            $"""
            SELECT Id, VenueId, Code, DiscountType, DiscountValue, MaxUses, UsedCount, MaxUsesPerUser,
                   ValidFrom, ValidTo, IsActive
            FROM PromotionCodes
            {where}
            ORDER BY ValidFrom DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { VenueId = venueId, Allowed = allowedVenues, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashPromoRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<IReadOnlyCollection<Guid>> AssignedVenueIdsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<Guid>(new CommandDefinition(
            "SELECT VenueId FROM UserVenues WHERE UserId = @UserId",
            new { UserId = userId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<string?> SavePromotionAsync(DashPromoWrite write, bool creating, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            if (creating)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT INTO PromotionCodes
                        (Id, VenueId, Code, DiscountType, DiscountValue, MaxUses, UsedCount, MaxUsesPerUser, ValidFrom, ValidTo, IsActive, CreatedAt, UpdatedAt)
                    VALUES
                        (@Id, @VenueId, @Code, @DiscountType, @DiscountValue, @MaxUses, 0, @MaxUsesPerUser, @ValidFrom, @ValidTo, @IsActive, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                    """,
                    write, tx, cancellationToken: cancellationToken));
            }
            else
            {
                var changed = await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE PromotionCodes
                    SET Code = @Code, DiscountType = @DiscountType, DiscountValue = @DiscountValue,
                        MaxUses = @MaxUses, MaxUsesPerUser = @MaxUsesPerUser, ValidFrom = @ValidFrom,
                        ValidTo = @ValidTo, IsActive = @IsActive, UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND ((@VenueId IS NULL AND VenueId IS NULL) OR VenueId = @VenueId)
                    """,
                    write, tx, cancellationToken: cancellationToken));
                if (changed == 0)
                {
                    return "That promotion was not found.";
                }
            }
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return "That promotion code is already in use.";
        }

        await AuditAsync(connection, tx, actorId, write.VenueId, creating ? "create" : "update", "PromotionCode", write.Id, write, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashPage<DashUserRow>> ListUsersAsync(string? query, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        var like = string.IsNullOrWhiteSpace(query) ? null : $"%{query.Trim()}%";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM Users
            WHERE IsDeleted = 0 AND (@Like IS NULL OR Email LIKE @Like OR DisplayName LIKE @Like)
            """,
            new { Like = like }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashUserRow>(new CommandDefinition(
            """
            SELECT Id, Email, DisplayName, FirstName, LastName, Mobile, Role, RewardPoints, EmailVerified
            FROM Users
            WHERE IsDeleted = 0 AND (@Like IS NULL OR Email LIKE @Like OR DisplayName LIKE @Like)
            ORDER BY Email
            LIMIT @Take OFFSET @Skip
            """,
            new { Like = like, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashUserRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashUserRow?> FindUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<DashUserRow>(new CommandDefinition(
            """
            SELECT Id, Email, DisplayName, FirstName, LastName, Mobile, Role, RewardPoints, EmailVerified
            FROM Users WHERE Id = @Id AND IsDeleted = 0
            """,
            new { Id = userId }, cancellationToken: cancellationToken));
    }

    public async Task<string?> UpdateUserAsync(Guid userId, string? displayName, string? firstName, string? lastName, string? mobile, string role, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Users
            SET DisplayName = @DisplayName, FirstName = @FirstName, LastName = @LastName,
                Mobile = @Mobile, Role = @Role, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND IsDeleted = 0
            """,
            new { Id = userId, DisplayName = displayName, FirstName = firstName, LastName = lastName, Mobile = mobile, Role = role },
            tx, cancellationToken: cancellationToken));
        if (changed == 0)
        {
            return "That user was not found.";
        }

        if (role != "staff")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "DELETE FROM UserVenues WHERE UserId = @Id",
                new { Id = userId }, tx, cancellationToken: cancellationToken));
        }

        await AuditAsync(connection, tx, actorId, null, "update", "User", userId, new { displayName, role }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<string?> SoftDeleteUserAsync(Guid userId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var email = await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT Email FROM Users WHERE Id = @Id AND IsDeleted = 0 FOR UPDATE",
            new { Id = userId }, tx, cancellationToken: cancellationToken));
        if (email is null)
        {
            return "That user was not found.";
        }

        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(email.Trim().ToLowerInvariant()))).ToLowerInvariant();
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Users
            SET IsDeleted = 1, DeletedAt = UTC_TIMESTAMP(6), EmailHash = @EmailHash,
                Email = CONCAT('deleted_', REPLACE(Id, '-', ''), '@invalid.local'),
                DisplayName = NULL, FirstName = NULL, LastName = NULL, Mobile = NULL,
                UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id
            """,
            new { Id = userId, EmailHash = hash }, tx, cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Sessions
            SET RevokedAt = UTC_TIMESTAMP(6), RevokeReason = 'account_deleted'
            WHERE UserId = @Id AND RevokedAt IS NULL
            """,
            new { Id = userId }, tx, cancellationToken: cancellationToken));
        await AuditAsync(connection, tx, actorId, null, "delete", "User", userId, new { userId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashAssignedVenueRow[]> ListAssignedVenuesAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashAssignedVenueRow>(new CommandDefinition(
            """
            SELECT v.Id, v.Name
            FROM UserVenues uv
            JOIN Venues v ON v.Id = uv.VenueId AND v.IsDeleted = 0
            WHERE uv.UserId = @UserId
            ORDER BY v.Name
            """,
            new { UserId = userId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<string?> AssignVenueAsync(Guid userId, Guid venueId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var role = await connection.ExecuteScalarAsync<string?>(new CommandDefinition(
            "SELECT Role FROM Users WHERE Id = @Id AND IsDeleted = 0",
            new { Id = userId }, cancellationToken: cancellationToken));
        if (role is null)
        {
            return "That user was not found.";
        }

        if (role != "staff")
        {
            return "Make this account staff before assigning a venue.";
        }

        var venue = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM Venues WHERE Id = @Id AND IsDeleted = 0",
            new { Id = venueId }, cancellationToken: cancellationToken));
        if (venue == 0)
        {
            return "That venue was not found.";
        }

        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT IGNORE INTO UserVenues (UserId, VenueId, CreatedAt)
            VALUES (@UserId, @VenueId, UTC_TIMESTAMP(6))
            """,
            new { UserId = userId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        await AuditAsync(connection, tx, actorId, venueId, "assign", "UserVenue", userId, new { userId, venueId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task UnassignVenueAsync(Guid userId, Guid venueId, Guid actorId, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            "DELETE FROM UserVenues WHERE UserId = @UserId AND VenueId = @VenueId",
            new { UserId = userId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        await AuditAsync(connection, tx, actorId, venueId, "unassign", "UserVenue", userId, new { userId, venueId }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<DashLoginRow[]> ListExternalLoginsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashLoginRow>(new CommandDefinition(
            """
            SELECT Provider, EmailAtLink, CreatedAt
            FROM ExternalLogins WHERE UserId = @UserId
            ORDER BY CreatedAt
            """,
            new { UserId = userId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<DashDeviceRow[]> ListUserSessionsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<DashDeviceRow>(new CommandDefinition(
            """
            SELECT Id, UserAgent, IpAddress, LastUsedAt, CreatedAt
            FROM Sessions
            WHERE UserId = @UserId AND RevokedAt IS NULL AND ReplacedBySessionId IS NULL AND ExpiresAt > UTC_TIMESTAMP(6)
            ORDER BY LastUsedAt DESC
            """,
            new { UserId = userId }, cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<DashPage<DashBookingRow>> ListOperationalBookingsAsync(Guid? venueId, IReadOnlyCollection<Guid> allowed, bool admin, string? status, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (Blocked(admin, allowed, venueId))
        {
            return new DashPage<DashBookingRow>([], pageNumber, size, 0);
        }

        var venueClause = admin
            ? "(@VenueId IS NULL OR b.VenueId = @VenueId)"
            : "b.VenueId IN @Allowed AND (@VenueId IS NULL OR b.VenueId = @VenueId)";
        var statusClause = string.IsNullOrWhiteSpace(status) ? "" : " AND b.Status = @Status";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM Bookings b WHERE b.IsDeleted = 0 AND {venueClause}{statusClause}",
            new { VenueId = venueId, Allowed = allowed, Status = status }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashBookingRow>(new CommandDefinition(
            $"""
            SELECT b.Id, b.VenueId, v.Name AS VenueName, v.TimeZone, c.CourtName, b.Status,
                   b.TotalAmount, v.Currency, cs.StartTime, cs.EndTime, u.Email AS UserEmail
            FROM Bookings b
            JOIN Venues v ON v.Id = b.VenueId
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Users u ON u.Id = b.UserId
            WHERE b.IsDeleted = 0 AND {venueClause}{statusClause}
            ORDER BY cs.StartTime DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { VenueId = venueId, Allowed = allowed, Status = status, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashBookingRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<string?> UpdateBookingStatusAsync(Guid bookingId, string status, Guid actorId, string role, string? ip, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<BookingHead>(new CommandDefinition(
            "SELECT VenueId, Status FROM Bookings WHERE Id = @Id AND IsDeleted = 0",
            new { Id = bookingId }, cancellationToken: cancellationToken));
        if (row is null)
        {
            return "That booking was not found.";
        }

        if (role != "admin" && !await CanAccessVenueAsync(actorId, role, row.VenueId, cancellationToken))
        {
            return "That booking was not found.";
        }

        var allowedChange = status == "cancelled" && row.Status is "pending" or "confirmed"
            || status is "completed" or "no_show" && row.Status == "confirmed";
        if (!allowedChange)
        {
            return "That status change is not available for this booking.";
        }

        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET Status = @Status, UpdatedAt = UTC_TIMESTAMP(6),
                CancelledAt = CASE WHEN @Status = 'cancelled' THEN UTC_TIMESTAMP(6) ELSE CancelledAt END,
                CancelledBy = CASE WHEN @Status = 'cancelled' THEN @ActorId ELSE CancelledBy END
            WHERE Id = @Id
            """,
            new { Id = bookingId, Status = status, ActorId = actorId }, tx, cancellationToken: cancellationToken));
        await AuditAsync(connection, tx, actorId, row.VenueId, "update", "Booking", bookingId, new { status }, ip, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return null;
    }

    public async Task<DashPage<DashPaymentRow>> ListPaymentsAsync(Guid? venueId, IReadOnlyCollection<Guid> allowed, bool admin, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (Blocked(admin, allowed, venueId))
        {
            return new DashPage<DashPaymentRow>([], pageNumber, size, 0);
        }

        var venueClause = admin
            ? "(@VenueId IS NULL OR b.VenueId = @VenueId)"
            : "b.VenueId IN @Allowed AND (@VenueId IS NULL OR b.VenueId = @VenueId)";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM Payments p JOIN Bookings b ON b.Id = p.BookingId WHERE {venueClause}",
            new { VenueId = venueId, Allowed = allowed }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashPaymentRow>(new CommandDefinition(
            $"""
            SELECT p.Id, 'payment' AS Kind, v.Name AS VenueName, p.Amount, p.Currency, p.Status, p.CreatedAt AS OccurredAt
            FROM Payments p
            JOIN Bookings b ON b.Id = p.BookingId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE {venueClause}
            ORDER BY p.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { VenueId = venueId, Allowed = allowed, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashPaymentRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashPage<DashPaymentRow>> ListRefundsAsync(Guid? venueId, IReadOnlyCollection<Guid> allowed, bool admin, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (Blocked(admin, allowed, venueId))
        {
            return new DashPage<DashPaymentRow>([], pageNumber, size, 0);
        }

        var venueClause = admin
            ? "(@VenueId IS NULL OR b.VenueId = @VenueId)"
            : "b.VenueId IN @Allowed AND (@VenueId IS NULL OR b.VenueId = @VenueId)";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"""
            SELECT COUNT(*) FROM Refunds r
            JOIN Payments p ON p.Id = r.PaymentId
            JOIN Bookings b ON b.Id = p.BookingId
            WHERE {venueClause}
            """,
            new { VenueId = venueId, Allowed = allowed }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashPaymentRow>(new CommandDefinition(
            $"""
            SELECT r.Id, 'refund' AS Kind, v.Name AS VenueName, r.Amount, p.Currency, r.Status, r.CreatedAt AS OccurredAt
            FROM Refunds r
            JOIN Payments p ON p.Id = r.PaymentId
            JOIN Bookings b ON b.Id = p.BookingId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE {venueClause}
            ORDER BY r.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { VenueId = venueId, Allowed = allowed, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashPaymentRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashPage<DashWebhookRow>> ListWebhooksAsync(bool admin, IReadOnlyCollection<Guid> allowed, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (!admin && allowed.Count == 0)
        {
            return new DashPage<DashWebhookRow>([], pageNumber, size, 0);
        }

        var where = admin
            ? ""
            : """
              WHERE EXISTS (
                SELECT 1 FROM Payments p
                JOIN Bookings b ON b.Id = p.BookingId
                WHERE p.StripePaymentIntentId = e.StripePaymentIntentId AND b.VenueId IN @Allowed
              )
              """;
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM StripeWebhookEvents e {where}",
            new { Allowed = allowed }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashWebhookRow>(new CommandDefinition(
            $"""
            SELECT e.Id, e.EventType, e.Status, e.CreatedAt
            FROM StripeWebhookEvents e
            {where}
            ORDER BY e.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { Allowed = allowed, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashWebhookRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashPage<DashAwardRow>> ListAwardsAsync(Guid? venueId, IReadOnlyCollection<Guid> allowed, bool admin, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (Blocked(admin, allowed, venueId))
        {
            return new DashPage<DashAwardRow>([], pageNumber, size, 0);
        }

        var venueClause = admin
            ? "(@VenueId IS NULL OR a.VenueId = @VenueId)"
            : "a.VenueId IN @Allowed AND (@VenueId IS NULL OR a.VenueId = @VenueId)";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM RewardPointAwards a WHERE {venueClause}",
            new { VenueId = venueId, Allowed = allowed }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashAwardRow>(new CommandDefinition(
            $"""
            SELECT a.Id, u.Email AS UserEmail, v.Name AS VenueName, v.TimeZone, a.Points, a.AwardedAt, cs.StartTime, cs.EndTime
            FROM RewardPointAwards a
            JOIN Users u ON u.Id = a.UserId
            JOIN Venues v ON v.Id = a.VenueId
            JOIN CourtSessions cs ON cs.Id = a.CourtSessionId
            WHERE {venueClause}
            ORDER BY a.AwardedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { VenueId = venueId, Allowed = allowed, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashAwardRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashPage<DashRedemptionRow>> ListRedemptionsAsync(Guid? venueId, IReadOnlyCollection<Guid> allowed, bool admin, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (Blocked(admin, allowed, venueId))
        {
            return new DashPage<DashRedemptionRow>([], pageNumber, size, 0);
        }

        var venueClause = admin
            ? "(@VenueId IS NULL OR b.VenueId = @VenueId)"
            : "b.VenueId IN @Allowed AND (@VenueId IS NULL OR b.VenueId = @VenueId)";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"""
            SELECT COUNT(*) FROM PromotionRedemptions r
            JOIN Bookings b ON b.Id = r.BookingId
            WHERE {venueClause}
            """,
            new { VenueId = venueId, Allowed = allowed }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashRedemptionRow>(new CommandDefinition(
            $"""
            SELECT r.Id, p.Code, u.Email AS UserEmail, v.Name AS VenueName, r.DiscountAmount, r.CreatedAt
            FROM PromotionRedemptions r
            JOIN PromotionCodes p ON p.Id = r.PromotionCodeId
            JOIN Users u ON u.Id = r.UserId
            JOIN Bookings b ON b.Id = r.BookingId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE {venueClause}
            ORDER BY r.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { VenueId = venueId, Allowed = allowed, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashRedemptionRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashPage<DashRecommendationRow>> ListRecommendationsAsync(bool admin, IReadOnlyCollection<Guid> allowed, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        if (!admin && allowed.Count == 0)
        {
            return new DashPage<DashRecommendationRow>([], pageNumber, size, 0);
        }

        var where = admin
            ? ""
            : "WHERE r.VenueId IN @Allowed";
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM AIRecommendations r {where}",
            new { Allowed = allowed }, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashRecommendationRow>(new CommandDefinition(
            $"""
            SELECT r.Id, u.Email AS UserEmail, r.RecommendationType, r.CreatedAt, v.Name AS VenueName
            FROM AIRecommendations r
            JOIN Users u ON u.Id = r.UserId
            LEFT JOIN Venues v ON v.Id = r.VenueId
            {where}
            ORDER BY r.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { Allowed = allowed, Take = size, Skip = skip }, cancellationToken: cancellationToken));
        return new DashPage<DashRecommendationRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task RecordPageViewAsync(Guid userId, Guid? venueId, string path, string title, string? ip, CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        await using var connection = await OpenAsync(cancellationToken);
        await AuditAsync(connection, null, userId, venueId, "page.view", "Page", id, new { path, title }, ip, cancellationToken);
    }

    public async Task<DashPage<DashAuditRow>> ListActivityAsync(Guid? onlyUserId, Guid? filterUserId, DateTime? from, DateTime? to, int page, CancellationToken cancellationToken)
    {
        var (pageNumber, size, skip) = PageOf(page);
        await using var connection = await OpenAsync(cancellationToken);
        var filter = new { OnlyUserId = onlyUserId, FilterUserId = filterUserId, From = from, To = to, Take = size, Skip = skip };
        const string where = """
            WHERE a.Action = 'page.view'
              AND (@OnlyUserId IS NULL OR a.UserId = @OnlyUserId)
              AND (@FilterUserId IS NULL OR a.UserId = @FilterUserId)
              AND (@From IS NULL OR a.CreatedAt >= @From)
              AND (@To IS NULL OR a.CreatedAt < @To)
            """;
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM AuditLogs a {where}", filter, cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<DashAuditRow>(new CommandDefinition(
            $"""
            SELECT a.Id, a.UserId, u.Email AS UserEmail, u.DisplayName, a.Action, a.Entity, a.NewValues, a.CreatedAt, v.Name AS VenueName
            FROM AuditLogs a
            LEFT JOIN Users u ON u.Id = a.UserId
            LEFT JOIN Venues v ON v.Id = a.VenueId
            {where}
            ORDER BY a.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            filter, cancellationToken: cancellationToken));
        return new DashPage<DashAuditRow>(rows.ToArray(), pageNumber, size, total);
    }

    public async Task<DashCounts> CountsAsync(Guid userId, string role, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var venueFilter = role == "admin"
            ? "IsDeleted = 0"
            : "IsDeleted = 0 AND Id IN (SELECT VenueId FROM UserVenues WHERE UserId = @UserId)";
        var venues = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"SELECT COUNT(*) FROM Venues WHERE {venueFilter}", new { UserId = userId }, cancellationToken: cancellationToken));
        var courts = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            $"""
            SELECT COUNT(*) FROM Courts c
            WHERE c.IsDeleted = 0 AND c.VenueId IN (SELECT Id FROM Venues WHERE {venueFilter})
            """,
            new { UserId = userId }, cancellationToken: cancellationToken));
        return new DashCounts(venues, courts);
    }

    private static async Task ApplyVenueIncentivesAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        var zoneId = await connection.ExecuteScalarAsync<string>(new CommandDefinition(
            "SELECT TimeZone FROM Venues WHERE Id = @VenueId",
            new { VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (string.IsNullOrWhiteSpace(zoneId))
        {
            return;
        }

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return;
        }

        var sessions = await connection.QueryAsync<SessionStartRow>(new CommandDefinition(
            """
            SELECT cs.Id, cs.StartTime
            FROM CourtSessions cs
            JOIN Bookings b ON b.CourtSessionId = cs.Id AND b.VenueId = cs.VenueId
            WHERE cs.VenueId = @VenueId AND cs.IsDeleted = 0
              AND b.Status = 'confirmed' AND b.IsDeleted = 0
            """,
            new { VenueId = venueId }, tx, cancellationToken: cancellationToken));
        foreach (var session in sessions)
        {
            var local = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(session.StartTime, DateTimeKind.Utc), zone));
            await SyncSessionIncentiveAsync(connection, tx, venueId, session.Id, local, actorId, cancellationToken);
        }
    }

    public async Task SnapshotBookingIncentiveAsync(Guid venueId, Guid sessionId, Guid actorId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var zoneId = await connection.ExecuteScalarAsync<string>(new CommandDefinition(
            "SELECT TimeZone FROM Venues WHERE Id = @VenueId",
            new { VenueId = venueId }, tx, cancellationToken: cancellationToken));
        var start = await connection.ExecuteScalarAsync<DateTime?>(new CommandDefinition(
            "SELECT StartTime FROM CourtSessions WHERE Id = @Id AND VenueId = @VenueId AND IsDeleted = 0",
            new { Id = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (start is null || string.IsNullOrWhiteSpace(zoneId))
        {
            return;
        }

        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            return;
        }

        var local = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(start.Value, DateTimeKind.Utc), zone));
        await SyncSessionIncentiveAsync(connection, tx, venueId, sessionId, local, actorId, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }

    private static async Task SyncSessionIncentiveAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        Guid sessionId,
        DateOnly localDay,
        Guid actorId,
        CancellationToken cancellationToken)
    {
        var day = localDay.ToDateTime(TimeOnly.MinValue);
        var points = await connection.ExecuteScalarAsync<int?>(new CommandDefinition(
            """
            SELECT Points FROM VenueIncentives
            WHERE VenueId = @VenueId AND IsActive = 1
              AND StartsOn <= @Day AND EndsOn >= @Day
            ORDER BY StartsOn
            LIMIT 1
            """,
            new { VenueId = venueId, Day = day }, tx, cancellationToken: cancellationToken));
        var awarded = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM RewardPointAwards a
            JOIN SessionIncentives si ON si.Id = a.SessionIncentiveId
            WHERE si.CourtSessionId = @SessionId AND si.VenueId = @VenueId
            """,
            new { SessionId = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
        if (awarded > 0)
        {
            return;
        }

        if (points is null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                "DELETE FROM SessionIncentives WHERE CourtSessionId = @SessionId AND VenueId = @VenueId",
                new { SessionId = sessionId, VenueId = venueId }, tx, cancellationToken: cancellationToken));
            return;
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO SessionIncentives
                (Id, VenueId, CourtSessionId, Points, IsActive, CreatedBy, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @VenueId, @SessionId, @Points, 1, @ActorId, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            ON DUPLICATE KEY UPDATE
                Points = VALUES(Points), IsActive = 1, UpdatedAt = UTC_TIMESTAMP(6)
            """,
            new { Id = Guid.NewGuid(), VenueId = venueId, SessionId = sessionId, Points = points.Value, ActorId = actorId },
            tx, cancellationToken: cancellationToken));
    }

    private static async Task AuditAsync(
        MySqlConnection connection,
        MySqlTransaction? tx,
        Guid actorId,
        Guid? venueId,
        string action,
        string entity,
        Guid entityId,
        object payload,
        string? ip,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO AuditLogs (Id, UserId, VenueId, Action, Entity, EntityId, NewValues, IpAddress, CreatedAt)
            VALUES (@Id, @UserId, @VenueId, @Action, @Entity, @EntityId, @NewValues, @IpAddress, UTC_TIMESTAMP(6))
            """,
            new
            {
                Id = Guid.NewGuid(),
                UserId = actorId,
                VenueId = venueId,
                Action = action,
                Entity = entity,
                EntityId = entityId,
                NewValues = JsonSerializer.Serialize(payload),
                IpAddress = ip,
            },
            tx, cancellationToken: cancellationToken));
    }

    private static bool Blocked(bool admin, IReadOnlyCollection<Guid> allowed, Guid? venueId) =>
        !admin && (allowed.Count == 0 || (venueId is not null && !allowed.Contains(venueId.Value)));

    private static (int Page, int Size, int Skip) PageOf(int page)
    {
        var number = page < 1 ? 1 : page;
        const int size = 20;
        return (number, size, (number - 1) * size);
    }

    private async Task<MySqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The MySQL connection string is not configured.");
        }

        var builder = new MySqlConnectionStringBuilder(connectionString) { GuidFormat = MySqlGuidFormat.Char36 };
        var connection = new MySqlConnection(builder.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}

public sealed record DashPage<T>(T[] Items, int Page, int PageSize, int Total);

public sealed record DashCounts(int Venues, int Courts);

public sealed record DashVenueWrite(
    Guid Id,
    string Name,
    string Slug,
    string? Description,
    string? Address,
    string? Suburb,
    string? State,
    string? Postcode,
    string Country,
    decimal? Latitude,
    decimal? Longitude,
    string? Phone,
    string? Email,
    string? ImageUrl,
    string TimeZone,
    string Currency,
    decimal LateCancelFeePercent,
    int PointsPerDollar,
    bool IsActive);

public sealed class DashVenueRow
{
    public Guid Id { get; init; }
    public string Name { get; init; } = "";
    public string Slug { get; init; } = "";
    public string? Description { get; init; }
    public string? Address { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Postcode { get; init; }
    public string Country { get; init; } = "AU";
    public decimal? Latitude { get; init; }
    public decimal? Longitude { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? ImageUrl { get; init; }
    public string TimeZone { get; init; } = "";
    public string Currency { get; init; } = "";
    public decimal LateCancelFeePercent { get; init; }
    public int PointsPerDollar { get; init; } = 100;
    public bool IsActive { get; init; }
}

public sealed record DashCourtWrite(Guid Id, Guid VenueId, string CourtName, int CourtNumber, string? Description, string? SurfaceType, string? ImageUrl, bool IsActive);

public sealed class DashCourtRow
{
    public Guid Id { get; init; }
    public Guid VenueId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public string? Description { get; init; }
    public string? SurfaceType { get; init; }
    public string? ImageUrl { get; init; }
    public bool IsActive { get; init; }
}

public sealed class DashSessionRow
{
    public Guid Id { get; init; }
    public Guid CourtId { get; init; }
    public string CourtName { get; init; } = "";
    public int CourtNumber { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public decimal Price { get; init; }
    public int? IncentivePoints { get; init; }
    public bool? IncentiveActive { get; init; }
}

file sealed class SessionStartRow
{
    public Guid Id { get; init; }
    public DateTime StartTime { get; init; }
}

public sealed class DashVenueIncentiveRow
{
    public Guid Id { get; init; }
    public int Points { get; init; }
    public DateTime StartsOn { get; init; }
    public DateTime EndsOn { get; init; }
    public bool IsActive { get; init; }
}

public sealed class DashClosureRow
{
    public Guid Id { get; init; }
    public Guid? CourtId { get; init; }
    public string? CourtName { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public string? Reason { get; init; }
}

public sealed record DashPromoWrite(
    Guid Id,
    Guid? VenueId,
    string Code,
    string DiscountType,
    decimal DiscountValue,
    int? MaxUses,
    int MaxUsesPerUser,
    DateTime ValidFrom,
    DateTime ValidTo,
    bool IsActive);

public sealed class DashPromoRow
{
    public Guid Id { get; init; }
    public Guid? VenueId { get; init; }
    public string Code { get; init; } = "";
    public string DiscountType { get; init; } = "";
    public decimal DiscountValue { get; init; }
    public int? MaxUses { get; init; }
    public int UsedCount { get; init; }
    public int MaxUsesPerUser { get; init; }
    public DateTime ValidFrom { get; init; }
    public DateTime ValidTo { get; init; }
    public bool IsActive { get; init; }
}

public sealed class DashUserRow
{
    public Guid Id { get; init; }
    public string Email { get; init; } = "";
    public string? DisplayName { get; init; }
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public string? Mobile { get; init; }
    public string Role { get; init; } = "";
    public int RewardPoints { get; init; }
    public bool EmailVerified { get; init; }
}

public sealed class DashAssignedVenueRow
{
    public Guid Id { get; init; }
    public string Name { get; init; } = "";
}

public sealed class DashLoginRow
{
    public string Provider { get; init; } = "";
    public string? EmailAtLink { get; init; }
    public DateTime CreatedAt { get; init; }
}

public sealed class DashDeviceRow
{
    public Guid Id { get; init; }
    public string? UserAgent { get; init; }
    public string? IpAddress { get; init; }
    public DateTime LastUsedAt { get; init; }
    public DateTime CreatedAt { get; init; }
}

public sealed class DashBookingRow
{
    public Guid Id { get; init; }
    public Guid VenueId { get; init; }
    public string VenueName { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public string CourtName { get; init; } = "";
    public string Status { get; init; } = "";
    public decimal TotalAmount { get; init; }
    public string Currency { get; init; } = "";
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public string UserEmail { get; init; } = "";
}

public sealed class DashPaymentRow
{
    public Guid Id { get; init; }
    public string Kind { get; init; } = "";
    public string VenueName { get; init; } = "";
    public decimal Amount { get; init; }
    public string Currency { get; init; } = "";
    public string Status { get; init; } = "";
    public DateTime OccurredAt { get; init; }
}

public sealed class DashWebhookRow
{
    public Guid Id { get; init; }
    public string EventType { get; init; } = "";
    public string Status { get; init; } = "";
    public DateTime CreatedAt { get; init; }
}

public sealed class DashAwardRow
{
    public Guid Id { get; init; }
    public string UserEmail { get; init; } = "";
    public string VenueName { get; init; } = "";
    public string TimeZone { get; init; } = "";
    public int Points { get; init; }
    public DateTime AwardedAt { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
}

public sealed class DashRedemptionRow
{
    public Guid Id { get; init; }
    public string Code { get; init; } = "";
    public string UserEmail { get; init; } = "";
    public string VenueName { get; init; } = "";
    public decimal DiscountAmount { get; init; }
    public DateTime CreatedAt { get; init; }
}

public sealed class DashRecommendationRow
{
    public Guid Id { get; init; }
    public string UserEmail { get; init; } = "";
    public string RecommendationType { get; init; } = "";
    public DateTime CreatedAt { get; init; }
    public string? VenueName { get; init; }
}

public sealed class BookingHead
{
    public Guid VenueId { get; init; }
    public string Status { get; init; } = "";
}

public sealed class DashAuditRow
{
    public Guid Id { get; init; }
    public Guid? UserId { get; init; }
    public string? UserEmail { get; init; }
    public string? DisplayName { get; init; }
    public string Action { get; init; } = "";
    public string Entity { get; init; } = "";
    public string? NewValues { get; init; }
    public DateTime CreatedAt { get; init; }
    public string? VenueName { get; init; }
}
