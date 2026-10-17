using Dapper;
using MySqlConnector;

namespace ShuttleSync.Api.Data;

public sealed class RecommendationRepository(IConfiguration configuration)
{
    public async Task<VenuePlayerItem[]> ListPlayersAsync(Guid venueId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = (await connection.QueryAsync<ComebackCandidate>(new CommandDefinition(
            CandidateSql + """
            
            ORDER BY
              CASE
                WHEN stats.NoShows > 0 THEN 0
                WHEN stats.Completed > 0 THEN 1
                WHEN stats.Cancels > 0 THEN 2
                ELSE 3
              END,
              stats.NoShows DESC,
              stats.LastCompleted ASC,
              stats.Cancels DESC
            LIMIT 20
            """,
            new { VenueId = venueId },
            cancellationToken: cancellationToken))).ToArray();
        return rows.Select(row => new VenuePlayerItem
        {
            Id = row.Id,
            Email = row.Email,
            DisplayName = row.DisplayName,
            Reason = Reason(row),
        }).ToArray();
    }

    public async Task<string?> CandidateReasonAsync(Guid venueId, Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<ComebackCandidate>(new CommandDefinition(
            CandidateSql + " AND u.Id = @UserId LIMIT 1",
            new { VenueId = venueId, UserId = userId },
            cancellationToken: cancellationToken));
        return row is null ? null : Reason(row);
    }

    public async Task<RecommendationItem?> FindTodayAsync(
        Guid venueId,
        Guid userId,
        DateTime dayStartUtc,
        DateTime dayEndUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var id = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            """
            SELECT Id FROM AIRecommendations
            WHERE UserId = @UserId AND VenueId = @VenueId AND RecommendationType = @RecommendationType
              AND CreatedAt >= @DayStart AND CreatedAt < @DayEnd
            LIMIT 1
            """,
            new { UserId = userId, VenueId = venueId, RecommendationType = NextVisitType, DayStart = dayStartUtc, DayEnd = dayEndUtc },
            cancellationToken: cancellationToken));
        if (id is null)
        {
            return null;
        }

        return await connection.QuerySingleOrDefaultAsync<RecommendationItem>(new CommandDefinition(
            RowSql + " WHERE r.Id = @Id",
            new { Id = id },
            cancellationToken: cancellationToken));
    }

    public async Task<RecommendationWriteResult> WriteNextVisitAsync(
        Guid venueId,
        Guid userId,
        int points,
        string message,
        string source,
        string reason,
        DateTime dayStartUtc,
        DateTime dayEndUtc,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var locked = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "SELECT Id FROM Users WHERE Id = @UserId AND IsDeleted = 0 FOR UPDATE",
            new { UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        if (locked is null)
        {
            return RecommendationWriteResult.Fail("Choose a player from the comeback list.");
        }

        var existingId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            """
            SELECT Id FROM AIRecommendations
            WHERE UserId = @UserId
              AND VenueId = @VenueId
              AND RecommendationType = @RecommendationType
              AND CreatedAt >= @DayStart
              AND CreatedAt < @DayEnd
            LIMIT 1
            """,
            new
            {
                UserId = userId,
                VenueId = venueId,
                RecommendationType = NextVisitType,
                DayStart = dayStartUtc,
                DayEnd = dayEndUtc,
            },
            tx,
            cancellationToken: cancellationToken));
        if (existingId is not null)
        {
            var existing = await FindAsync(connection, tx, existingId.Value, cancellationToken);
            if (existing is null)
            {
                return RecommendationWriteResult.Fail("The recommendation could not be saved.");
            }

            await tx.CommitAsync(cancellationToken);
            return new RecommendationWriteResult(null, false, existing);
        }

        var id = Guid.NewGuid();
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            title = "Come back and play",
            text = message,
            source,
            points,
            reason,
        });
        // RecommendationType values inserted here:
        // next_visit — a personal comeback note. Payload.source is gemini or fallback.
        // The same user, venue, type, and venue-local day keeps this row and does not add another grant.
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO AIRecommendations (Id, UserId, VenueId, RecommendationType, Payload, CreatedAt)
            VALUES (@Id, @UserId, @VenueId, @RecommendationType, CAST(@Payload AS JSON), UTC_TIMESTAMP(6))
            """,
            new
            {
                Id = id,
                UserId = userId,
                VenueId = venueId,
                RecommendationType = NextVisitType,
                Payload = payload,
            },
            tx,
            cancellationToken: cancellationToken));
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO ComebackPointGrants (Id, RecommendationId, UserId, VenueId, Points, CreatedAt)
            VALUES (@GrantId, @Id, @UserId, @VenueId, @Points, UTC_TIMESTAMP(6))
            """,
            new { GrantId = Guid.NewGuid(), Id = id, UserId = userId, VenueId = venueId, Points = points },
            tx,
            cancellationToken: cancellationToken));
        var created = await FindAsync(connection, tx, id, cancellationToken);
        if (created is null)
        {
            return RecommendationWriteResult.Fail("The recommendation could not be saved.");
        }

        await tx.CommitAsync(cancellationToken);
        return new RecommendationWriteResult(null, true, created);
    }

    public async Task<RecommendationPage> ListMineAsync(Guid userId, int page, int pageSize, CancellationToken cancellationToken)
    {
        var number = page < 1 ? 1 : page;
        var size = pageSize is 5 or 10 or 20 or 50 ? pageSize : 5;
        var skip = (number - 1) * size;
        await using var connection = await OpenAsync(cancellationToken);
        var total = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM AIRecommendations WHERE UserId = @UserId",
            new { UserId = userId },
            cancellationToken: cancellationToken));
        var rows = await connection.QueryAsync<RecommendationItem>(new CommandDefinition(
            """
            SELECT r.Id, r.RecommendationType, r.CreatedAt, r.ReadAt, v.Name AS VenueName, v.TimeZone,
                   CAST(r.Payload AS CHAR) AS Payload
            FROM AIRecommendations r
            LEFT JOIN Venues v ON v.Id = r.VenueId
            WHERE r.UserId = @UserId
            ORDER BY r.CreatedAt DESC
            LIMIT @Take OFFSET @Skip
            """,
            new { UserId = userId, Take = size, Skip = skip },
            cancellationToken: cancellationToken));
        return new RecommendationPage(rows.ToArray(), number, size, total);
    }

    public async Task<int> CountUnreadAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM AIRecommendations WHERE UserId = @UserId AND ReadAt IS NULL",
            new { UserId = userId },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> MarkReadAsync(Guid userId, Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var owned = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM AIRecommendations WHERE Id = @Id AND UserId = @UserId",
            new { Id = id, UserId = userId },
            cancellationToken: cancellationToken));
        if (owned != 1)
        {
            return false;
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE AIRecommendations
            SET ReadAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND UserId = @UserId AND ReadAt IS NULL
            """,
            new { Id = id, UserId = userId },
            cancellationToken: cancellationToken));
        return true;
    }

    public async Task<int> MarkAllReadAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE AIRecommendations
            SET ReadAt = UTC_TIMESTAMP(6)
            WHERE UserId = @UserId AND ReadAt IS NULL
            """,
            new { UserId = userId },
            cancellationToken: cancellationToken));
    }

    private static async Task<RecommendationItem?> FindAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid id,
        CancellationToken cancellationToken)
    {
        return await connection.QuerySingleOrDefaultAsync<RecommendationItem>(new CommandDefinition(
            """
            SELECT r.Id, u.Email AS UserEmail, u.DisplayName, r.RecommendationType, r.CreatedAt,
                   v.Name AS VenueName, v.TimeZone, CAST(r.Payload AS CHAR) AS Payload
            FROM AIRecommendations r
            JOIN Users u ON u.Id = r.UserId
            LEFT JOIN Venues v ON v.Id = r.VenueId
            WHERE r.Id = @Id
            """,
            new { Id = id },
            tx,
            cancellationToken: cancellationToken));
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

    private static string Reason(ComebackCandidate row)
    {
        if (row.NoShows > 0)
        {
            return row.NoShows == 1 ? "1 no-show, no upcoming visit" : $"{row.NoShows} no-shows, no upcoming visit";
        }

        if (row.Completed > 0 && row.LastCompleted is DateTime last)
        {
            return $"Last completed visit {last:d MMM yyyy}";
        }

        if (row.Cancels > 0)
        {
            return row.Cancels == 1 ? "1 cancellation" : $"{row.Cancels} cancellations";
        }

        return "Played once";
    }

    private const string RowSql = """
        SELECT r.Id, u.Email AS UserEmail, u.DisplayName, r.RecommendationType, r.CreatedAt,
               v.Name AS VenueName, v.TimeZone, CAST(r.Payload AS CHAR) AS Payload
        FROM AIRecommendations r
        JOIN Users u ON u.Id = r.UserId
        LEFT JOIN Venues v ON v.Id = r.VenueId
        """;

    private const string CandidateSql = """
        SELECT u.Id, u.Email, u.DisplayName, stats.NoShows, stats.Cancels, stats.Completed, stats.Plays, stats.LastCompleted
        FROM Users u
        JOIN (
          SELECT UserId,
                 CAST(SUM(Status = 'no_show') AS SIGNED) AS NoShows,
                 CAST(SUM(Status = 'cancelled') AS SIGNED) AS Cancels,
                 CAST(SUM(Status = 'completed') AS SIGNED) AS Completed,
                 COUNT(*) AS Plays,
                 MAX(CASE WHEN Status = 'completed' THEN EndTime END) AS LastCompleted
          FROM (
            SELECT b.UserId, b.Status, cs.EndTime
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.VenueId = @VenueId AND b.IsDeleted = 0
            UNION ALL
            SELECT r.UserId, 'completed', s.EndTime
            FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            WHERE r.VenueId = @VenueId AND s.IsDeleted = 0 AND r.Status = 'confirmed' AND s.EndTime <= UTC_TIMESTAMP(6)
          ) activity
          GROUP BY UserId
        ) stats ON stats.UserId = u.Id
        WHERE u.IsDeleted = 0
          AND (stats.NoShows > 0 OR stats.Completed > 0 OR stats.Cancels > 0 OR stats.Plays = 1)
          AND NOT EXISTS (
            SELECT 1 FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            WHERE b.UserId = u.Id AND b.VenueId = @VenueId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed') AND cs.EndTime > UTC_TIMESTAMP(6)
          )
          AND NOT EXISTS (
            SELECT 1 FROM PublicSocialRegistrations r
            JOIN PublicSocials s ON s.Id = r.SocialId
            WHERE r.UserId = u.Id AND r.VenueId = @VenueId AND s.IsDeleted = 0
              AND r.Status = 'confirmed' AND s.EndTime > UTC_TIMESTAMP(6)
          )
        """;

    private const string NextVisitType = "next_visit";
}

public sealed record RecommendationWriteResult(string? Error, bool Created, RecommendationItem? Item)
{
    public static RecommendationWriteResult Fail(string error) => new(error, false, null);
}

public sealed record RecommendationPage(RecommendationItem[] Items, int Page, int PageSize, int Total);

public sealed class RecommendationItem
{
    public Guid Id { get; init; }
    public string UserEmail { get; init; } = "";
    public string? DisplayName { get; init; }
    public string RecommendationType { get; init; } = "";
    public DateTime CreatedAt { get; init; }
    public DateTime? ReadAt { get; init; }
    public string? VenueName { get; init; }
    public string? TimeZone { get; init; }
    public string? Payload { get; init; }
}

public sealed class VenuePlayerItem
{
    public Guid Id { get; init; }
    public string Email { get; init; } = "";
    public string? DisplayName { get; init; }
    public string Reason { get; init; } = "";
}

public sealed class ComebackCandidate
{
    public Guid Id { get; init; }
    public string Email { get; init; } = "";
    public string? DisplayName { get; init; }
    public int NoShows { get; init; }
    public int Cancels { get; init; }
    public int Completed { get; init; }
    public int Plays { get; init; }
    public DateTime? LastCompleted { get; init; }
}
