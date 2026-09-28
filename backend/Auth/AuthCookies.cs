namespace ShuttleSync.Api.Auth;

public static class AuthCookies
{
    public const string Access = "__Host-ss_access";
    public const string Refresh = "__Host-ss_refresh";
    public const string Csrf = "__Host-ss_csrf";
    public const string OAuthState = "__Host-ss_oauth";

    public static void SetSession(
        HttpContext http,
        AuthSettings settings,
        string accessToken,
        string refreshToken,
        string csrfToken,
        TimeSpan refreshLifetime)
    {
        Append(http, settings, Access, accessToken, TimeSpan.FromMinutes(settings.AccessTokenMinutes), httpOnly: true);
        Append(http, settings, Refresh, refreshToken, refreshLifetime, httpOnly: true);
        Append(http, settings, Csrf, csrfToken, refreshLifetime, httpOnly: false);
    }

    public static void SetOAuthState(HttpContext http, AuthSettings settings, string value) =>
        Append(http, settings, OAuthState, value, TimeSpan.FromMinutes(10), httpOnly: true);

    public static void ClearSession(HttpContext http, AuthSettings settings)
    {
        Delete(http, settings, Access, httpOnly: true);
        Delete(http, settings, Refresh, httpOnly: true);
        Delete(http, settings, Csrf, httpOnly: false);
    }

    public static void ClearOAuthState(HttpContext http, AuthSettings settings) =>
        Delete(http, settings, OAuthState, httpOnly: true);

    public static void EnsureCsrf(HttpContext http, AuthSettings settings)
    {
        if (http.Request.Cookies.ContainsKey(Csrf))
        {
            return;
        }

        Append(http, settings, Csrf, TokenProtection.CreateToken(), TimeSpan.FromDays(settings.RefreshTokenDays), httpOnly: false);
    }

    private static void Append(
        HttpContext http,
        AuthSettings settings,
        string name,
        string value,
        TimeSpan lifetime,
        bool httpOnly)
    {
        http.Response.Cookies.Append(name, value, Options(settings, httpOnly, lifetime));
    }

    private static void Delete(HttpContext http, AuthSettings settings, string name, bool httpOnly)
    {
        http.Response.Cookies.Delete(name, Options(settings, httpOnly, lifetime: null));
    }

    private static CookieOptions Options(AuthSettings settings, bool httpOnly, TimeSpan? lifetime) =>
        new()
        {
            HttpOnly = httpOnly,
            Secure = settings.CookieSecure,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            MaxAge = lifetime,
            IsEssential = true,
        };
}
