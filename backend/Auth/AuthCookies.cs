namespace ShuttleSync.Api.Auth;

public static class AuthCookies
{
    private const string AccessHost = "__Host-ss_access";
    private const string RefreshHost = "__Host-ss_refresh";
    private const string CsrfHost = "__Host-ss_csrf";
    private const string OAuthHost = "__Host-ss_oauth";
    private const string AccessPlain = "ss_access";
    private const string RefreshPlain = "ss_refresh";
    private const string CsrfPlain = "ss_csrf";
    private const string OAuthPlain = "ss_oauth";

    public static void SetSession(
        HttpContext http,
        AuthSettings settings,
        string accessToken,
        string refreshToken,
        string csrfToken,
        TimeSpan refreshLifetime)
    {
        var secure = UseHostPrefix(http, settings);
        Append(http, secure, AccessName(secure), accessToken, TimeSpan.FromMinutes(settings.AccessTokenMinutes), httpOnly: true);
        Append(http, secure, RefreshName(secure), refreshToken, refreshLifetime, httpOnly: true);
        Append(http, secure, CsrfName(secure), csrfToken, refreshLifetime, httpOnly: false);
    }

    public static void SetAccess(HttpContext http, AuthSettings settings, string accessToken)
    {
        var secure = UseHostPrefix(http, settings);
        Append(http, secure, AccessName(secure), accessToken, TimeSpan.FromMinutes(settings.AccessTokenMinutes), httpOnly: true);
    }

    public static void SetOAuthState(HttpContext http, AuthSettings settings, string value)
    {
        var secure = UseHostPrefix(http, settings);
        Append(http, secure, OAuthName(secure), value, TimeSpan.FromMinutes(10), httpOnly: true);
    }

    public static void ClearSession(HttpContext http, AuthSettings settings)
    {
        DeletePair(http, AccessPlain, AccessHost, httpOnly: true);
        DeletePair(http, RefreshPlain, RefreshHost, httpOnly: true);
        DeletePair(http, CsrfPlain, CsrfHost, httpOnly: false);
    }

    public static void ClearOAuthState(HttpContext http, AuthSettings settings)
    {
        _ = settings;
        DeletePair(http, OAuthPlain, OAuthHost, httpOnly: true);
    }

    public static void EnsureCsrf(HttpContext http, AuthSettings settings)
    {
        if (TryGetCsrf(http, out _))
        {
            return;
        }

        var secure = UseHostPrefix(http, settings);
        Append(http, secure, CsrfName(secure), TokenProtection.CreateToken(), TimeSpan.FromDays(settings.RefreshTokenDays), httpOnly: false);
    }

    public static bool TryGetAccess(HttpContext http, out string value) =>
        TryGet(http, AccessPlain, AccessHost, out value);

    public static bool TryGetRefresh(HttpContext http, out string value) =>
        TryGet(http, RefreshPlain, RefreshHost, out value);

    public static bool TryGetCsrf(HttpContext http, out string value) =>
        TryGet(http, CsrfPlain, CsrfHost, out value);

    public static bool TryGetOAuthState(HttpContext http, out string value) =>
        TryGet(http, OAuthPlain, OAuthHost, out value);

    public static bool HasSessionCookie(HttpContext http) =>
        http.Request.Cookies.ContainsKey(AccessPlain)
        || http.Request.Cookies.ContainsKey(AccessHost)
        || http.Request.Cookies.ContainsKey(RefreshPlain)
        || http.Request.Cookies.ContainsKey(RefreshHost);

    private static bool UseHostPrefix(HttpContext http, AuthSettings settings) =>
        settings.CookieSecure && http.Request.IsHttps;

    private static string AccessName(bool secure) => secure ? AccessHost : AccessPlain;

    private static string RefreshName(bool secure) => secure ? RefreshHost : RefreshPlain;

    private static string CsrfName(bool secure) => secure ? CsrfHost : CsrfPlain;

    private static string OAuthName(bool secure) => secure ? OAuthHost : OAuthPlain;

    private static bool TryGet(HttpContext http, string plainName, string hostName, out string value)
    {
        var preferHost = http.Request.IsHttps;
        var first = preferHost ? hostName : plainName;
        var second = preferHost ? plainName : hostName;
        if (http.Request.Cookies.TryGetValue(first, out var primary) && !string.IsNullOrWhiteSpace(primary))
        {
            value = primary;
            return true;
        }

        if (http.Request.Cookies.TryGetValue(second, out var fallback) && !string.IsNullOrWhiteSpace(fallback))
        {
            value = fallback;
            return true;
        }

        value = "";
        return false;
    }

    private static void Append(
        HttpContext http,
        bool secure,
        string name,
        string value,
        TimeSpan lifetime,
        bool httpOnly)
    {
        http.Response.Cookies.Append(name, value, Options(secure, httpOnly, lifetime));
    }

    private static void DeletePair(HttpContext http, string plainName, string hostName, bool httpOnly)
    {
        http.Response.Cookies.Delete(plainName, Options(secure: false, httpOnly, lifetime: null));
        http.Response.Cookies.Delete(hostName, Options(secure: true, httpOnly, lifetime: null));
    }

    private static CookieOptions Options(bool secure, bool httpOnly, TimeSpan? lifetime) =>
        new()
        {
            HttpOnly = httpOnly,
            Secure = secure,
            SameSite = SameSiteMode.Lax,
            Path = "/",
            MaxAge = lifetime,
            IsEssential = true,
        };
}
