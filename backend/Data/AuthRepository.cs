using System.Data;
using Dapper;
using MySqlConnector;
using ShuttleSync.Api.Auth;

namespace ShuttleSync.Api.Data;

public sealed class AuthRepository(IConfiguration configuration)
{
    public async Task<UserRow?> FindUserByEmailAsync(string email, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<UserRow>(
            new CommandDefinition(
                """
                SELECT Id, Email, EmailVerified, PasswordHash, DisplayName,
                       UserAvatar, FirstName, LastName, Mobile, Role, RewardPoints
                FROM Users
                WHERE Email = @Email
                """,
                new { Email = email },
                cancellationToken: cancellationToken));
    }

    public async Task<UserRow?> FindUserByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<UserRow>(
            new CommandDefinition(
                """
                SELECT Id, Email, EmailVerified, PasswordHash, DisplayName,
                       UserAvatar, FirstName, LastName, Mobile, Role, RewardPoints
                FROM Users
                WHERE Id = @Id
                """,
                new { Id = id },
                cancellationToken: cancellationToken));
    }

    public async Task<bool> CreatePasswordUserAsync(UserRow user, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        try
        {
            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    INSERT INTO Users (Id, Email, EmailVerified, PasswordHash, DisplayName, CreatedAt, UpdatedAt)
                    VALUES (@Id, @Email, @EmailVerified, @PasswordHash, @DisplayName, @CreatedAt, @UpdatedAt)
                    """,
                    new
                    {
                        user.Id,
                        user.Email,
                        user.EmailVerified,
                        user.PasswordHash,
                        user.DisplayName,
                        CreatedAt = DateTimeOffset.UtcNow,
                        UpdatedAt = DateTimeOffset.UtcNow,
                    },
                    cancellationToken: cancellationToken));
            return true;
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return false;
        }
    }

    public async Task<ExternalLoginRow?> FindExternalLoginAsync(
        string provider,
        string providerUserId,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<ExternalLoginRow>(
            new CommandDefinition(
                """
                SELECT Id, UserId, Provider, ProviderUserId
                FROM ExternalLogins
                WHERE Provider = @Provider AND ProviderUserId = @ProviderUserId
                """,
                new { Provider = provider, ProviderUserId = providerUserId },
                cancellationToken: cancellationToken));
    }

    public async Task<bool> CreateExternalUserAsync(
        UserRow user,
        string provider,
        string providerUserId,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        try
        {
            var now = DateTimeOffset.UtcNow;
            await connection.ExecuteAsync(
                new CommandDefinition(
                    """
                    INSERT INTO Users (Id, Email, EmailVerified, PasswordHash, DisplayName, CreatedAt, UpdatedAt)
                    VALUES (@Id, @Email, @EmailVerified, NULL, @DisplayName, @Now, @Now)
                    """,
                    new
                    {
                        user.Id,
                        user.Email,
                        user.EmailVerified,
                        user.DisplayName,
                        Now = now,
                    },
                    transaction: transaction,
                    cancellationToken: cancellationToken));
            await InsertExternalLoginAsync(connection, transaction, user.Id, provider, providerUserId, user.Email, now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return true;
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }
    }

    public async Task<bool> LinkExternalLoginAsync(
        Guid userId,
        string provider,
        string providerUserId,
        string email,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        try
        {
            await InsertExternalLoginAsync(
                connection,
                transaction: null,
                userId,
                provider,
                providerUserId,
                email,
                DateTimeOffset.UtcNow,
                cancellationToken);
            return true;
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return false;
        }
    }

    public async Task<SessionRow> CreateSessionAsync(
        Guid userId,
        byte[] refreshTokenHash,
        DateTimeOffset expiresAt,
        string? userAgent,
        string? ipAddress,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var session = new SessionRow
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            FamilyId = Guid.NewGuid(),
            RefreshTokenHash = refreshTokenHash,
            ExpiresAt = expiresAt,
            UserAgent = userAgent,
            IpAddress = ipAddress,
            CreatedAt = now,
            LastUsedAt = now,
        };

        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(InsertSessionSql, session, cancellationToken: cancellationToken));
        return session;
    }

    public async Task<SessionRow?> FindCurrentSessionAsync(Guid sessionId, Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<SessionRow>(
            new CommandDefinition(
                """
                SELECT Id, UserId, FamilyId, RefreshTokenHash, ReplacedBySessionId, ExpiresAt, RevokedAt,
                       UserAgent, IpAddress, CreatedAt, LastUsedAt
                FROM Sessions
                WHERE Id = @Id
                  AND UserId = @UserId
                  AND ReplacedBySessionId IS NULL
                  AND RevokedAt IS NULL
                  AND ExpiresAt > UTC_TIMESTAMP(6)
                """,
                new { Id = sessionId, UserId = userId },
                cancellationToken: cancellationToken));
    }

    public async Task<IReadOnlyList<SessionRow>> ListCurrentSessionsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<SessionRow>(
            new CommandDefinition(
                """
                SELECT Id, UserId, FamilyId, RefreshTokenHash, ReplacedBySessionId, ExpiresAt, RevokedAt,
                       UserAgent, IpAddress, CreatedAt, LastUsedAt
                FROM Sessions
                WHERE UserId = @UserId
                  AND ReplacedBySessionId IS NULL
                  AND RevokedAt IS NULL
                  AND ExpiresAt > UTC_TIMESTAMP(6)
                ORDER BY LastUsedAt DESC
                """,
                new { UserId = userId },
                cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task<RotateResult> RotateAsync(
        byte[] presentedHash,
        byte[] nextHash,
        Guid nextSessionId,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var current = await connection.QuerySingleOrDefaultAsync<SessionRow>(
            new CommandDefinition(
                """
                SELECT Id, UserId, FamilyId, RefreshTokenHash, ReplacedBySessionId, ExpiresAt, RevokedAt,
                       UserAgent, IpAddress, CreatedAt, LastUsedAt
                FROM Sessions
                WHERE RefreshTokenHash = @Hash
                FOR UPDATE
                """,
                new { Hash = presentedHash },
                transaction,
                cancellationToken: cancellationToken));

        if (current is null || !TokenProtection.FixedTimeEquals(current.RefreshTokenHash, presentedHash))
        {
            TokenProtection.FixedTimeEquals(presentedHash, new byte[32]);
            await transaction.CommitAsync(cancellationToken);
            return RotateResult.Invalid.Instance;
        }

        if (current.ReplacedBySessionId is not null)
        {
            await RevokeFamilyAsync(connection, transaction, current.FamilyId, "reuse", cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return RotateResult.Reuse.Instance;
        }

        if (current.RevokedAt is not null || current.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            await transaction.CommitAsync(cancellationToken);
            return RotateResult.Invalid.Instance;
        }

        var now = DateTimeOffset.UtcNow;
        var next = new SessionRow
        {
            Id = nextSessionId,
            UserId = current.UserId,
            FamilyId = current.FamilyId,
            RefreshTokenHash = nextHash,
            ExpiresAt = current.ExpiresAt,
            UserAgent = current.UserAgent,
            IpAddress = current.IpAddress,
            CreatedAt = now,
            LastUsedAt = now,
        };

        await connection.ExecuteAsync(new CommandDefinition(InsertSessionSql, next, transaction, cancellationToken: cancellationToken));
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Sessions
                SET ReplacedBySessionId = @NextId, LastUsedAt = @Now
                WHERE Id = @Id
                """,
                new { NextId = nextSessionId, Now = now, current.Id },
                transaction,
                cancellationToken: cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return new RotateResult.Rotated(next);
    }

    public async Task<SessionRow?> RevokeSessionAsync(Guid sessionId, Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var session = await connection.QuerySingleOrDefaultAsync<SessionRow>(
            new CommandDefinition(
                """
                SELECT Id, UserId, FamilyId, RefreshTokenHash, ReplacedBySessionId, ExpiresAt, RevokedAt,
                       UserAgent, IpAddress, CreatedAt, LastUsedAt
                FROM Sessions
                WHERE Id = @Id
                  AND UserId = @UserId
                  AND ReplacedBySessionId IS NULL
                  AND RevokedAt IS NULL
                FOR UPDATE
                """,
                new { Id = sessionId, UserId = userId },
                transaction,
                cancellationToken: cancellationToken));
        if (session is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var revokedAt = DateTimeOffset.UtcNow;
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Sessions
                SET RevokedAt = @RevokedAt, RevokeReason = @Reason, LastUsedAt = @RevokedAt
                WHERE Id = @Id
                """,
                new { Id = sessionId, RevokedAt = revokedAt, Reason = "revoked" },
                transaction,
                cancellationToken: cancellationToken));
        await transaction.CommitAsync(cancellationToken);
        return session;
    }

    public async Task RevokeFamilyBySessionAsync(Guid sessionId, Guid userId, string reason, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var familyId = await connection.QuerySingleOrDefaultAsync<Guid?>(
            new CommandDefinition(
                "SELECT FamilyId FROM Sessions WHERE Id = @Id AND UserId = @UserId",
                new { Id = sessionId, UserId = userId },
                transaction,
                cancellationToken: cancellationToken));
        if (familyId is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        await RevokeFamilyAsync(connection, transaction, familyId.Value, reason, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task UpdateProfileAsync(
        Guid userId,
        string? displayName,
        string? firstName,
        string? lastName,
        string? mobile,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Users
                SET DisplayName = @DisplayName,
                    FirstName = @FirstName,
                    LastName = @LastName,
                    Mobile = @Mobile,
                    UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new
                {
                    Id = userId,
                    DisplayName = displayName,
                    FirstName = firstName,
                    LastName = lastName,
                    Mobile = mobile,
                },
                cancellationToken: cancellationToken));
    }

    public async Task UpdateAvatarAsync(Guid userId, string avatarUrl, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Users
                SET UserAvatar = @UserAvatar, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = userId, UserAvatar = avatarUrl },
                cancellationToken: cancellationToken));
    }

    public async Task<ExternalLoginRow[]> ListExternalLoginsAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = await connection.QueryAsync<ExternalLoginRow>(
            new CommandDefinition(
                """
                SELECT Id, UserId, Provider, ProviderUserId, EmailAtLink, CreatedAt
                FROM ExternalLogins
                WHERE UserId = @UserId
                ORDER BY CreatedAt
                """,
                new { UserId = userId },
                cancellationToken: cancellationToken));
        return rows.ToArray();
    }

    public async Task RevokeOtherSessionsAsync(Guid userId, Guid currentSessionId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Sessions
                SET RevokedAt = UTC_TIMESTAMP(6), RevokeReason = @Reason
                WHERE UserId = @UserId
                  AND Id <> @SessionId
                  AND RevokedAt IS NULL
                  AND ReplacedBySessionId IS NULL
                """,
                new { UserId = userId, SessionId = currentSessionId, Reason = "logout-others" },
                cancellationToken: cancellationToken));
    }

    public async Task RevokeAllForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Sessions
                SET RevokedAt = UTC_TIMESTAMP(6), RevokeReason = @Reason
                WHERE UserId = @UserId AND RevokedAt IS NULL
                """,
                new { UserId = userId, Reason = "logout-all" },
                cancellationToken: cancellationToken));
    }

    private static async Task InsertExternalLoginAsync(
        MySqlConnection connection,
        IDbTransaction? transaction,
        Guid userId,
        string provider,
        string providerUserId,
        string email,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                INSERT INTO ExternalLogins (Id, UserId, Provider, ProviderUserId, EmailAtLink, CreatedAt)
                VALUES (@Id, @UserId, @Provider, @ProviderUserId, @Email, @CreatedAt)
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    UserId = userId,
                    Provider = provider,
                    ProviderUserId = providerUserId,
                    Email = email,
                    CreatedAt = createdAt,
                },
                transaction,
                cancellationToken: cancellationToken));
    }

    private static async Task RevokeFamilyAsync(
        MySqlConnection connection,
        IDbTransaction transaction,
        Guid familyId,
        string reason,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE Sessions
                SET RevokedAt = UTC_TIMESTAMP(6), RevokeReason = @Reason
                WHERE FamilyId = @FamilyId AND RevokedAt IS NULL
                """,
                new { FamilyId = familyId, Reason = reason },
                transaction,
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

    private const string InsertSessionSql =
        """
        INSERT INTO Sessions
            (Id, UserId, FamilyId, RefreshTokenHash, ExpiresAt, UserAgent, IpAddress, CreatedAt, LastUsedAt)
        VALUES
            (@Id, @UserId, @FamilyId, @RefreshTokenHash, @ExpiresAt, @UserAgent, @IpAddress, @CreatedAt, @LastUsedAt)
        """;
}

public sealed class UserRow
{
    public Guid Id { get; init; }
    public string Email { get; init; } = "";
    public bool EmailVerified { get; init; }
    public string? PasswordHash { get; init; }
    public string? DisplayName { get; init; }
    public string? UserAvatar { get; init; }
    public string? FirstName { get; init; }
    public string? LastName { get; init; }
    public string? Mobile { get; init; }
    public string Role { get; init; } = "user";
    public int RewardPoints { get; init; }
}

public sealed class ExternalLoginRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string Provider { get; init; } = "";
    public string ProviderUserId { get; init; } = "";
    public string? EmailAtLink { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
}

public sealed class SessionRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public Guid FamilyId { get; init; }
    public byte[] RefreshTokenHash { get; init; } = [];
    public Guid? ReplacedBySessionId { get; init; }
    public DateTimeOffset ExpiresAt { get; init; }
    public DateTimeOffset? RevokedAt { get; init; }
    public string? UserAgent { get; init; }
    public string? IpAddress { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset LastUsedAt { get; init; }
}

public abstract record RotateResult
{
    public sealed record Rotated(SessionRow Session) : RotateResult;
    public sealed record Invalid : RotateResult
    {
        public static readonly Invalid Instance = new();
    }

    public sealed record Reuse : RotateResult
    {
        public static readonly Reuse Instance = new();
    }
}
