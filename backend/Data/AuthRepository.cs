using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
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
                SELECT Id, Email, EmailVerified, PasswordHash, DisplayName
                FROM dbo.Users
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
                SELECT Id, Email, EmailVerified, PasswordHash, DisplayName
                FROM dbo.Users
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
                    INSERT INTO dbo.Users (Id, Email, EmailVerified, PasswordHash, DisplayName, CreatedAt, UpdatedAt)
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
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
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
                FROM dbo.ExternalLogins
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
                    INSERT INTO dbo.Users (Id, Email, EmailVerified, PasswordHash, DisplayName, CreatedAt, UpdatedAt)
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
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
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
        catch (SqlException exception) when (exception.Number is 2601 or 2627)
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
                FROM dbo.Sessions
                WHERE Id = @Id
                  AND UserId = @UserId
                  AND ReplacedBySessionId IS NULL
                  AND RevokedAt IS NULL
                  AND ExpiresAt > SYSUTCDATETIME()
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
                FROM dbo.Sessions
                WHERE UserId = @UserId
                  AND ReplacedBySessionId IS NULL
                  AND RevokedAt IS NULL
                  AND ExpiresAt > SYSUTCDATETIME()
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
                FROM dbo.Sessions WITH (UPDLOCK, ROWLOCK)
                WHERE RefreshTokenHash = @Hash
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
                UPDATE dbo.Sessions
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
        var session = await connection.QuerySingleOrDefaultAsync<SessionRow>(
            new CommandDefinition(
                """
                UPDATE dbo.Sessions
                SET RevokedAt = SYSUTCDATETIME(), RevokeReason = @Reason, LastUsedAt = SYSUTCDATETIME()
                OUTPUT inserted.Id, inserted.UserId, inserted.FamilyId, inserted.RefreshTokenHash,
                       inserted.ReplacedBySessionId, inserted.ExpiresAt, inserted.RevokedAt,
                       inserted.UserAgent, inserted.IpAddress, inserted.CreatedAt, inserted.LastUsedAt
                WHERE Id = @Id
                  AND UserId = @UserId
                  AND ReplacedBySessionId IS NULL
                  AND RevokedAt IS NULL
                """,
                new { Id = sessionId, UserId = userId, Reason = "revoked" },
                cancellationToken: cancellationToken));
        return session;
    }

    public async Task RevokeFamilyBySessionAsync(Guid sessionId, Guid userId, string reason, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var familyId = await connection.QuerySingleOrDefaultAsync<Guid?>(
            new CommandDefinition(
                "SELECT FamilyId FROM dbo.Sessions WHERE Id = @Id AND UserId = @UserId",
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

    public async Task RevokeAllForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE dbo.Sessions
                SET RevokedAt = SYSUTCDATETIME(), RevokeReason = @Reason
                WHERE UserId = @UserId AND RevokedAt IS NULL
                """,
                new { UserId = userId, Reason = "logout-all" },
                cancellationToken: cancellationToken));
    }

    private static async Task InsertExternalLoginAsync(
        SqlConnection connection,
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
                INSERT INTO dbo.ExternalLogins (Id, UserId, Provider, ProviderUserId, EmailAtLink, CreatedAt)
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
        SqlConnection connection,
        IDbTransaction transaction,
        Guid familyId,
        string reason,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(
            new CommandDefinition(
                """
                UPDATE dbo.Sessions
                SET RevokedAt = SYSUTCDATETIME(), RevokeReason = @Reason
                WHERE FamilyId = @FamilyId AND RevokedAt IS NULL
                """,
                new { FamilyId = familyId, Reason = reason },
                transaction,
                cancellationToken: cancellationToken));
    }

    private async Task<SqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The SQL Server connection string is not configured.");
        }

        var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    private const string InsertSessionSql =
        """
        INSERT INTO dbo.Sessions
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
}

public sealed class ExternalLoginRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string Provider { get; init; } = "";
    public string ProviderUserId { get; init; } = "";
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
