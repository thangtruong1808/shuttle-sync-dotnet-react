using Microsoft.AspNetCore.Identity;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Auth;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapGet("/csrf", (HttpContext http, AuthSettings settings) =>
        {
            AuthCookies.EnsureCsrf(http, settings);
            return Results.NoContent();
        });

        auth.MapPost("/register", RegisterAsync);
        auth.MapPost("/login", LoginAsync);
        auth.MapPost("/refresh", RefreshAsync);

        var signedIn = auth.MapGroup("").RequireAuthorization();
        signedIn.MapGet("/me", MeAsync);
        signedIn.MapGet("/sessions", SessionsAsync);
        signedIn.MapDelete("/sessions/{id:guid}", RevokeSessionAsync);
        signedIn.MapPost("/logout", LogoutAsync);
        signedIn.MapPost("/logout-all", LogoutAllAsync);
    }

    private static async Task<IResult> RegisterAsync(
        CredentialRequest request,
        HttpContext http,
        AuthRepository repository,
        PasswordHasher<UserRow> passwordHasher,
        AuthRateLimiter rateLimiter,
        CancellationToken cancellationToken)
    {
        var errors = CredentialRules.Validate(request.Email, request.Password);
        if (errors.Count > 0)
        {
            return Validation(errors);
        }

        var email = CredentialRules.NormalizeEmail(request.Email);
        if (!rateLimiter.Permit(ClientIp(http), email))
        {
            return TooManyAttempts();
        }

        var user = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = email,
            EmailVerified = false,
        };
        user = new UserRow
        {
            Id = user.Id,
            Email = user.Email,
            EmailVerified = false,
            PasswordHash = passwordHasher.HashPassword(user, request.Password ?? ""),
        };

        var created = await repository.CreatePasswordUserAsync(user, cancellationToken);
        if (!created)
        {
            return Validation(new Dictionary<string, string[]>
            {
                ["email"] = ["An account with this email already exists."],
            }, StatusCodes.Status409Conflict);
        }

        return Results.Json(ToUser(user), statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> LoginAsync(
        CredentialRequest request,
        HttpContext http,
        AuthRepository repository,
        PasswordHasher<UserRow> passwordHasher,
        AccessTokens tokens,
        AuthSettings settings,
        AuthRateLimiter rateLimiter,
        CancellationToken cancellationToken)
    {
        var errors = CredentialRules.Validate(request.Email, request.Password);
        if (errors.Count > 0)
        {
            return Validation(errors);
        }

        var email = CredentialRules.NormalizeEmail(request.Email);
        if (!rateLimiter.Permit(ClientIp(http), email))
        {
            return TooManyAttempts();
        }

        var user = await repository.FindUserByEmailAsync(email, cancellationToken);
        var passwordOk = user?.PasswordHash is not null
            && passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password ?? "")
                is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
        if (user is null || !passwordOk)
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]>
                {
                    ["form"] = ["Invalid email or password."],
                },
            }, statusCode: StatusCodes.Status401Unauthorized);
        }

        await IssueSessionAsync(http, repository, tokens, settings, user, cancellationToken);
        return Results.Ok(ToUser(user));
    }

    private static async Task<IResult> RefreshAsync(
        HttpContext http,
        AuthRepository repository,
        AccessTokens tokens,
        AuthSettings settings,
        CancellationToken cancellationToken)
    {
        if (!http.Request.Cookies.TryGetValue(AuthCookies.Refresh, out var refreshToken)
            || string.IsNullOrWhiteSpace(refreshToken))
        {
            AuthCookies.ClearSession(http, settings);
            return SignInAgain();
        }

        var nextSessionId = Guid.NewGuid();
        var nextRefreshToken = TokenProtection.CreateToken();
        var rotation = await repository.RotateAsync(
            TokenProtection.Sha256(refreshToken),
            TokenProtection.Sha256(nextRefreshToken),
            nextSessionId,
            cancellationToken);

        if (rotation is not RotateResult.Rotated rotated)
        {
            AuthCookies.ClearSession(http, settings);
            return SignInAgain();
        }

        var user = await repository.FindUserByIdAsync(rotated.Session.UserId, cancellationToken);
        if (user is null)
        {
            AuthCookies.ClearSession(http, settings);
            return SignInAgain();
        }

        var remaining = rotated.Session.ExpiresAt - DateTimeOffset.UtcNow;
        if (remaining <= TimeSpan.Zero)
        {
            AuthCookies.ClearSession(http, settings);
            return SignInAgain();
        }

        AuthCookies.SetSession(
            http,
            settings,
            tokens.Create(user, rotated.Session.Id),
            nextRefreshToken,
            TokenProtection.CreateToken(),
            remaining);
        return Results.Ok(ToUser(user));
    }

    private static async Task<IResult> MeAsync(
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        var user = await repository.FindUserByIdAsync(current.UserId, cancellationToken);
        return user is null ? SignInAgain() : Results.Ok(ToUser(user));
    }

    private static async Task<IResult> SessionsAsync(
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        var sessions = await repository.ListCurrentSessionsAsync(current.UserId, cancellationToken);
        return Results.Ok(sessions.Select(session => new
        {
            id = session.Id,
            createdAt = session.CreatedAt,
            lastUsedAt = session.LastUsedAt,
            userAgent = session.UserAgent,
            ipAddress = session.IpAddress,
            isCurrent = session.Id == current.Id,
        }));
    }

    private static async Task<IResult> RevokeSessionAsync(
        Guid id,
        HttpContext http,
        AuthRepository repository,
        AuthSettings settings,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        var revoked = await repository.RevokeSessionAsync(id, current.UserId, cancellationToken);
        if (revoked is null)
        {
            return Results.NotFound();
        }

        if (revoked.Id == current.Id)
        {
            AuthCookies.ClearSession(http, settings);
        }

        return Results.NoContent();
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext http,
        AuthRepository repository,
        AuthSettings settings,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is not null)
        {
            await repository.RevokeFamilyBySessionAsync(current.Id, current.UserId, "logout", cancellationToken);
        }

        AuthCookies.ClearSession(http, settings);
        return Results.NoContent();
    }

    private static async Task<IResult> LogoutAllAsync(
        HttpContext http,
        AuthRepository repository,
        AuthSettings settings,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is not null)
        {
            await repository.RevokeAllForUserAsync(current.UserId, cancellationToken);
        }

        AuthCookies.ClearSession(http, settings);
        return Results.NoContent();
    }

    internal static async Task IssueSessionAsync(
        HttpContext http,
        AuthRepository repository,
        AccessTokens tokens,
        AuthSettings settings,
        UserRow user,
        CancellationToken cancellationToken)
    {
        var (userAgent, ipAddress) = Client(http);
        var refreshToken = TokenProtection.CreateToken();
        var expiresAt = DateTimeOffset.UtcNow.AddDays(settings.RefreshTokenDays);
        var session = await repository.CreateSessionAsync(
            user.Id,
            TokenProtection.Sha256(refreshToken),
            expiresAt,
            userAgent,
            ipAddress,
            cancellationToken);
        AuthCookies.SetSession(
            http,
            settings,
            tokens.Create(user, session.Id),
            refreshToken,
            TokenProtection.CreateToken(),
            expiresAt - DateTimeOffset.UtcNow);
    }

    private static async Task<SessionRow?> CurrentSessionAsync(
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(http.User.FindFirst("sub")?.Value, out var userId)
            || !Guid.TryParse(http.User.FindFirst("sid")?.Value, out var sessionId))
        {
            return null;
        }

        return await repository.FindCurrentSessionAsync(sessionId, userId, cancellationToken);
    }

    private static (string? UserAgent, string? IpAddress) Client(HttpContext http)
    {
        var userAgent = http.Request.Headers.UserAgent.ToString();
        if (userAgent.Length > 512)
        {
            userAgent = userAgent[..512];
        }

        var ipAddress = http.Connection.RemoteIpAddress?.ToString();
        if (ipAddress is { Length: > 64 })
        {
            ipAddress = ipAddress[..64];
        }

        return (string.IsNullOrEmpty(userAgent) ? null : userAgent, string.IsNullOrEmpty(ipAddress) ? null : ipAddress);
    }

    private static string ClientIp(HttpContext http) =>
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown";

    private static IResult Validation(Dictionary<string, string[]> errors, int status = StatusCodes.Status400BadRequest) =>
        Results.Json(new { errors }, statusCode: status);

    private static IResult TooManyAttempts() =>
        Results.Json(new
        {
            errors = new Dictionary<string, string[]>
            {
                ["form"] = ["Too many attempts. Try again later."],
            },
        }, statusCode: StatusCodes.Status429TooManyRequests);

    private static IResult SignInAgain() =>
        Results.Json(new
        {
            errors = new Dictionary<string, string[]>
            {
                ["form"] = ["Sign in again."],
            },
        }, statusCode: StatusCodes.Status401Unauthorized);

    internal static object ToUser(UserRow user) => new
    {
        id = user.Id,
        email = user.Email,
        displayName = user.DisplayName,
        emailVerified = user.EmailVerified,
    };

    private sealed record CredentialRequest(string? Email, string? Password);
}
