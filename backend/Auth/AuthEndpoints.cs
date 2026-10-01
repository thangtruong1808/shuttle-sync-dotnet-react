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
        auth.MapGet("/me", MeAsync);

        var signedIn = auth.MapGroup("").RequireAuthorization();
        signedIn.MapPut("/profile", UpdateProfileAsync);
        signedIn.MapPost("/avatar", UploadAvatarAsync);
        signedIn.MapGet("/external-logins", ExternalLoginsAsync);
        signedIn.MapGet("/sessions", SessionsAsync);
        signedIn.MapDelete("/sessions/{id:guid}", RevokeSessionAsync);
        signedIn.MapPost("/logout", LogoutAsync);
        signedIn.MapPost("/logout-others", LogoutOthersAsync);
        signedIn.MapPost("/logout-all", LogoutAllAsync);

        auth.MapGet("/avatars/{fileName}", AvatarFile);
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
            // The access cookie expires with the JWT. The refresh cookie lasts for
            // REFRESH_TOKEN_DAYS, so a 401 tells the browser to rotate and stay signed in.
            var canRefresh = http.Request.Cookies.ContainsKey(AuthCookies.Access)
                || http.Request.Cookies.ContainsKey(AuthCookies.Refresh);
            return canRefresh ? SignInAgain() : Results.NoContent();
        }

        var user = await repository.FindUserByIdAsync(current.UserId, cancellationToken);
        return user is null ? SignInAgain() : Results.Ok(ToUser(user));
    }

    private static async Task<IResult> UpdateProfileAsync(
        ProfileRequest request,
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        var displayName = TrimToNull(request.DisplayName, 200);
        var firstName = TrimToNull(request.FirstName, 100);
        var lastName = TrimToNull(request.LastName, 100);
        var mobile = TrimToNull(request.Mobile, 32);
        if (request.DisplayName is { Length: > 200 }
            || request.FirstName is { Length: > 100 }
            || request.LastName is { Length: > 100 }
            || request.Mobile is { Length: > 32 })
        {
            return Validation(new Dictionary<string, string[]>
            {
                ["form"] = ["One of the profile fields is too long."],
            });
        }

        await repository.UpdateProfileAsync(current.UserId, displayName, firstName, lastName, mobile, cancellationToken);
        var user = await repository.FindUserByIdAsync(current.UserId, cancellationToken);
        return user is null ? SignInAgain() : Results.Ok(ToUser(user));
    }

    private static async Task<IResult> UploadAvatarAsync(
        HttpRequest request,
        HttpContext http,
        AuthRepository repository,
        IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        if (!request.HasFormContentType)
        {
            return Validation(new Dictionary<string, string[]>
            {
                ["form"] = ["Choose an image file."],
            });
        }

        var file = request.Form.Files.GetFile("avatar");
        if (file is null || file.Length == 0)
        {
            return Validation(new Dictionary<string, string[]>
            {
                ["form"] = ["Choose an image file."],
            });
        }

        if (file.Length > 2 * 1024 * 1024)
        {
            return Validation(new Dictionary<string, string[]>
            {
                ["form"] = ["Image must be 2 MB or smaller."],
            });
        }

        var extension = file.ContentType switch
        {
            "image/jpeg" => ".jpg",
            "image/png" => ".png",
            "image/webp" => ".webp",
            _ => null,
        };
        if (extension is null)
        {
            return Validation(new Dictionary<string, string[]>
            {
                ["form"] = ["Use a JPEG, PNG, or WebP image."],
            });
        }

        var directory = Path.Combine(environment.ContentRootPath, "App_Data", "avatars");
        Directory.CreateDirectory(directory);
        var fileName = $"{current.UserId:D}{extension}";
        var path = Path.Combine(directory, fileName);
        await using (var stream = File.Create(path))
        {
            await file.CopyToAsync(stream, cancellationToken);
        }

        foreach (var oldExtension in new[] { ".jpg", ".png", ".webp" })
        {
            if (oldExtension == extension)
            {
                continue;
            }

            var oldPath = Path.Combine(directory, $"{current.UserId:D}{oldExtension}");
            if (File.Exists(oldPath))
            {
                File.Delete(oldPath);
            }
        }

        var url = $"/api/auth/avatars/{fileName}";
        await repository.UpdateAvatarAsync(current.UserId, url, cancellationToken);
        var user = await repository.FindUserByIdAsync(current.UserId, cancellationToken);
        return user is null ? SignInAgain() : Results.Ok(ToUser(user));
    }

    private static IResult AvatarFile(string fileName, IWebHostEnvironment environment)
    {
        if (fileName != Path.GetFileName(fileName))
        {
            return Results.NotFound();
        }

        var extension = Path.GetExtension(fileName);
        if (!Guid.TryParse(Path.GetFileNameWithoutExtension(fileName), out _)
            || extension is not (".jpg" or ".png" or ".webp"))
        {
            return Results.NotFound();
        }

        var path = Path.Combine(environment.ContentRootPath, "App_Data", "avatars", fileName);
        if (!File.Exists(path))
        {
            return Results.NotFound();
        }

        var contentType = extension switch
        {
            ".png" => "image/png",
            ".jpg" => "image/jpeg",
            _ => "image/webp",
        };
        return Results.File(path, contentType);
    }

    private static async Task<IResult> ExternalLoginsAsync(
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        var logins = await repository.ListExternalLoginsAsync(current.UserId, cancellationToken);
        return Results.Ok(logins.Select(login => new
        {
            provider = login.Provider,
            emailAtLink = login.EmailAtLink,
            createdAt = login.CreatedAt,
        }));
    }

    private static async Task<IResult> LogoutOthersAsync(
        HttpContext http,
        AuthRepository repository,
        CancellationToken cancellationToken)
    {
        var current = await CurrentSessionAsync(http, repository, cancellationToken);
        if (current is null)
        {
            return SignInAgain();
        }

        await repository.RevokeOtherSessionsAsync(current.UserId, current.Id, cancellationToken);
        return Results.NoContent();
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

    internal static async Task<SessionRow?> CurrentSessionAsync(
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
        firstName = user.FirstName,
        lastName = user.LastName,
        mobile = user.Mobile,
        userAvatar = user.UserAvatar,
        rewardPoints = user.RewardPoints,
        role = user.Role,
    };

    private static string? TrimToNull(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length > max ? trimmed[..max] : trimmed;
    }

    private sealed record CredentialRequest(string? Email, string? Password);

    private sealed record ProfileRequest(string? DisplayName, string? FirstName, string? LastName, string? Mobile);
}
