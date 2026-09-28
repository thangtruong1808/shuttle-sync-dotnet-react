namespace ShuttleSync.Api.Auth;

public sealed record AuthSettings(
    string JwtSigningKey,
    string JwtIssuer,
    string JwtAudience,
    int AccessTokenMinutes,
    int RefreshTokenDays,
    bool CookieSecure,
    string FrontendOrigin,
    string GoogleClientId,
    string GoogleClientSecret,
    string GoogleRedirectUri,
    string GitHubClientId,
    string GitHubClientSecret,
    string GitHubRedirectUri)
{
    public const int MinimumSigningKeyLength = 32;

    public static AuthSettings FromConfiguration(IConfiguration configuration)
    {
        var signingKey = configuration["JWT_SIGNING_KEY"] ?? "";
        if (signingKey.Length < MinimumSigningKeyLength)
        {
            throw new InvalidOperationException(
                "JWT_SIGNING_KEY must be set to at least 32 characters.");
        }

        var issuer = Required(configuration, "JWT_ISSUER");
        var audience = Required(configuration, "JWT_AUDIENCE");
        var accessMinutes = PositiveInt(configuration["ACCESS_TOKEN_MINUTES"], "ACCESS_TOKEN_MINUTES");
        var refreshDays = PositiveInt(configuration["REFRESH_TOKEN_DAYS"], "REFRESH_TOKEN_DAYS");
        var cookieSecure = !bool.TryParse(configuration["COOKIE_SECURE"], out var parsed) || parsed;
        var frontendOrigin = (configuration["FRONTEND_ORIGIN"] ?? "").Trim().TrimEnd('/');

        return new AuthSettings(
            signingKey,
            issuer,
            audience,
            accessMinutes,
            refreshDays,
            cookieSecure,
            frontendOrigin,
            configuration["GOOGLE_CLIENT_ID"] ?? "",
            configuration["GOOGLE_CLIENT_SECRET"] ?? "",
            configuration["GOOGLE_REDIRECT_URI"] ?? "",
            configuration["GITHUB_CLIENT_ID"] ?? "",
            configuration["GITHUB_CLIENT_SECRET"] ?? "",
            configuration["GITHUB_REDIRECT_URI"] ?? "");
    }

    private static string Required(IConfiguration configuration, string name)
    {
        var value = configuration[name];
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException($"{name} must be set.");
        }

        return value.Trim();
    }

    private static int PositiveInt(string? value, string name)
    {
        if (!int.TryParse(value, out var parsed) || parsed <= 0)
        {
            throw new InvalidOperationException($"{name} must be a positive integer.");
        }

        return parsed;
    }
}
