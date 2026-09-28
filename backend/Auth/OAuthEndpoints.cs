using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.WebUtilities;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Auth;

public static class OAuthEndpoints
{
    public static void MapOAuthEndpoints(this WebApplication app)
    {
        var auth = app.MapGroup("/api/auth");
        auth.MapGet("/google/start", (HttpContext http, AuthSettings settings) =>
            Start(http, settings, "google", "https://accounts.google.com/o/oauth2/v2/auth", new Dictionary<string, string?>
            {
                ["client_id"] = settings.GoogleClientId,
                ["redirect_uri"] = settings.GoogleRedirectUri,
                ["response_type"] = "code",
                ["scope"] = "openid email profile",
            }, settings.GoogleClientId, settings.GoogleClientSecret, settings.GoogleRedirectUri, "Google"));

        auth.MapGet("/github/start", (HttpContext http, AuthSettings settings) =>
            Start(http, settings, "github", "https://github.com/login/oauth/authorize", new Dictionary<string, string?>
            {
                ["client_id"] = settings.GitHubClientId,
                ["redirect_uri"] = settings.GitHubRedirectUri,
                ["scope"] = "read:user user:email",
            }, settings.GitHubClientId, settings.GitHubClientSecret, settings.GitHubRedirectUri, "GitHub"));

        auth.MapGet("/google/callback", (HttpContext http, AuthSettings settings, AuthRepository repository, AccessTokens tokens, IHttpClientFactory httpClientFactory, ILoggerFactory loggerFactory, CancellationToken cancellationToken) =>
            CallbackAsync(http, settings, repository, tokens, httpClientFactory, loggerFactory.CreateLogger("OAuth"), "google", cancellationToken));

        auth.MapGet("/github/callback", (HttpContext http, AuthSettings settings, AuthRepository repository, AccessTokens tokens, IHttpClientFactory httpClientFactory, ILoggerFactory loggerFactory, CancellationToken cancellationToken) =>
            CallbackAsync(http, settings, repository, tokens, httpClientFactory, loggerFactory.CreateLogger("OAuth"), "github", cancellationToken));
    }

    private static IResult Start(
        HttpContext http,
        AuthSettings settings,
        string provider,
        string authorizeUrl,
        Dictionary<string, string?> query,
        string clientId,
        string clientSecret,
        string redirectUri,
        string providerLabel)
    {
        if (string.IsNullOrWhiteSpace(clientId)
            || string.IsNullOrWhiteSpace(clientSecret)
            || string.IsNullOrWhiteSpace(redirectUri))
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]>
                {
                    ["form"] = [$"{providerLabel} sign-in is not configured."],
                },
            }, statusCode: StatusCodes.Status500InternalServerError);
        }

        var state = TokenProtection.CreateToken();
        var verifier = TokenProtection.CreateToken();
        query["state"] = state;
        query["code_challenge"] = TokenProtection.CreateCodeChallenge(verifier);
        query["code_challenge_method"] = "S256";
        AuthCookies.SetOAuthState(http, settings, $"{provider}.{state}.{verifier}");
        return Results.Redirect(QueryHelpers.AddQueryString(authorizeUrl, query));
    }

    private static async Task<IResult> CallbackAsync(
        HttpContext http,
        AuthSettings settings,
        AuthRepository repository,
        AccessTokens tokens,
        IHttpClientFactory httpClientFactory,
        ILogger logger,
        string provider,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(settings.FrontendOrigin))
        {
            return Results.Json(new
            {
                errors = new Dictionary<string, string[]>
                {
                    ["form"] = ["FRONTEND_ORIGIN must be set."],
                },
            }, statusCode: StatusCodes.Status500InternalServerError);
        }

        var code = http.Request.Query["code"].ToString();
        var state = http.Request.Query["state"].ToString();
        http.Request.Cookies.TryGetValue(AuthCookies.OAuthState, out var oauthCookie);
        AuthCookies.ClearOAuthState(http, settings);

        if (string.IsNullOrWhiteSpace(code)
            || oauthCookie is null
            || !TryReadState(oauthCookie, provider, state, out var verifier))
        {
            return RedirectError(settings, "oauth_failed");
        }

        var client = httpClientFactory.CreateClient("oauth");
        ProviderIdentity? identity = provider switch
        {
            "google" => await ReadGoogleIdentityAsync(client, settings, code, verifier, logger, cancellationToken),
            "github" => await ReadGitHubIdentityAsync(client, settings, code, verifier, logger, cancellationToken),
            _ => null,
        };

        if (identity is null)
        {
            return RedirectError(settings, "oauth_failed");
        }

        if (!identity.EmailVerified || string.IsNullOrWhiteSpace(identity.Email))
        {
            return RedirectError(settings, "email_unverified");
        }

        var email = CredentialRules.NormalizeEmail(identity.Email);
        if (CredentialRules.Validate(email, "Password12345").ContainsKey("email"))
        {
            return RedirectError(settings, "email_unverified");
        }

        var completion = await CompleteSignInAsync(repository, provider, identity with { Email = email }, cancellationToken);
        if (completion.PasswordAccount)
        {
            return RedirectError(settings, "password_account");
        }

        if (completion.User is null)
        {
            return RedirectError(settings, "oauth_failed");
        }

        await AuthEndpoints.IssueSessionAsync(http, repository, tokens, settings, completion.User, cancellationToken);
        return Results.Redirect($"{settings.FrontendOrigin}/");
    }

    private static async Task<SignInCompletion> CompleteSignInAsync(
        AuthRepository repository,
        string provider,
        ProviderIdentity identity,
        CancellationToken cancellationToken)
    {
        var existingLogin = await repository.FindExternalLoginAsync(provider, identity.ProviderUserId, cancellationToken);
        if (existingLogin is not null)
        {
            var linkedUser = await repository.FindUserByIdAsync(existingLogin.UserId, cancellationToken);
            return new SignInCompletion(linkedUser, PasswordAccount: false);
        }

        var existingUser = await repository.FindUserByEmailAsync(identity.Email, cancellationToken);
        if (existingUser is not null)
        {
            if (!string.IsNullOrEmpty(existingUser.PasswordHash))
            {
                return new SignInCompletion(null, PasswordAccount: true);
            }

            var linked = await repository.LinkExternalLoginAsync(
                existingUser.Id,
                provider,
                identity.ProviderUserId,
                identity.Email,
                cancellationToken);
            return new SignInCompletion(linked ? existingUser : null, PasswordAccount: false);
        }

        var displayName = string.IsNullOrWhiteSpace(identity.DisplayName)
            ? null
            : identity.DisplayName.Trim();
        if (displayName is { Length: > 200 })
        {
            displayName = displayName[..200];
        }

        var created = new UserRow
        {
            Id = Guid.NewGuid(),
            Email = identity.Email,
            EmailVerified = true,
            DisplayName = displayName,
        };
        var createdOk = await repository.CreateExternalUserAsync(created, provider, identity.ProviderUserId, cancellationToken);
        return new SignInCompletion(createdOk ? created : null, PasswordAccount: false);
    }

    private static bool TryReadState(string cookie, string provider, string state, out string verifier)
    {
        verifier = "";
        var parts = cookie.Split('.', 3);
        if (parts.Length != 3 || parts[0] != provider || string.IsNullOrEmpty(parts[1]) || string.IsNullOrEmpty(parts[2]))
        {
            return false;
        }

        if (!TokenProtection.FixedTimeEquals(parts[1], state))
        {
            return false;
        }

        verifier = parts[2];
        return true;
    }

    private static async Task<ProviderIdentity?> ReadGoogleIdentityAsync(
        HttpClient client,
        AuthSettings settings,
        string code,
        string verifier,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["code"] = code,
                ["client_id"] = settings.GoogleClientId,
                ["client_secret"] = settings.GoogleClientSecret,
                ["redirect_uri"] = settings.GoogleRedirectUri,
                ["grant_type"] = "authorization_code",
                ["code_verifier"] = verifier,
            }),
        };
        var accessToken = await ReadAccessTokenAsync(client, tokenRequest, logger, cancellationToken);
        if (accessToken is null)
        {
            return null;
        }

        using var userRequest = new HttpRequestMessage(HttpMethod.Get, "https://openidconnect.googleapis.com/v1/userinfo");
        userRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var userResponse = await client.SendAsync(userRequest, cancellationToken);
        if (!userResponse.IsSuccessStatusCode)
        {
            logger.LogWarning("Google user info request failed with status {StatusCode}.", (int)userResponse.StatusCode);
            return null;
        }

        var profile = await userResponse.Content.ReadFromJsonAsync<GoogleProfile>(cancellationToken);
        if (profile?.Subject is null)
        {
            return null;
        }

        return new ProviderIdentity(profile.Subject, profile.Email ?? "", profile.EmailVerified, profile.Name);
    }

    private static async Task<ProviderIdentity?> ReadGitHubIdentityAsync(
        HttpClient client,
        AuthSettings settings,
        string code,
        string verifier,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        using var tokenRequest = new HttpRequestMessage(HttpMethod.Post, "https://github.com/login/oauth/access_token")
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["client_id"] = settings.GitHubClientId,
                ["client_secret"] = settings.GitHubClientSecret,
                ["code"] = code,
                ["redirect_uri"] = settings.GitHubRedirectUri,
                ["code_verifier"] = verifier,
            }),
        };
        tokenRequest.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        tokenRequest.Headers.UserAgent.ParseAdd("ShuttleSync");
        var accessToken = await ReadAccessTokenAsync(client, tokenRequest, logger, cancellationToken);
        if (accessToken is null)
        {
            return null;
        }

        using var userRequest = AuthorizedGitHubRequest(HttpMethod.Get, "https://api.github.com/user", accessToken);
        using var userResponse = await client.SendAsync(userRequest, cancellationToken);
        if (!userResponse.IsSuccessStatusCode)
        {
            logger.LogWarning("GitHub user request failed with status {StatusCode}.", (int)userResponse.StatusCode);
            return null;
        }

        var profile = await userResponse.Content.ReadFromJsonAsync<GitHubProfile>(cancellationToken);
        if (profile is null)
        {
            return null;
        }

        using var emailRequest = AuthorizedGitHubRequest(HttpMethod.Get, "https://api.github.com/user/emails", accessToken);
        using var emailResponse = await client.SendAsync(emailRequest, cancellationToken);
        if (!emailResponse.IsSuccessStatusCode)
        {
            logger.LogWarning("GitHub email request failed with status {StatusCode}.", (int)emailResponse.StatusCode);
            return null;
        }

        var emails = await emailResponse.Content.ReadFromJsonAsync<List<GitHubEmail>>(cancellationToken) ?? [];
        var email = emails.FirstOrDefault(item => item.Primary && item.Verified);
        return new ProviderIdentity(
            profile.Id.ToString(),
            email?.Email ?? "",
            email?.Verified ?? false,
            string.IsNullOrWhiteSpace(profile.Name) ? profile.Login : profile.Name);
    }

    private static HttpRequestMessage AuthorizedGitHubRequest(HttpMethod method, string url, string accessToken)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.UserAgent.ParseAdd("ShuttleSync");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return request;
    }

    private static async Task<string?> ReadAccessTokenAsync(
        HttpClient client,
        HttpRequestMessage request,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("OAuth token request failed with status {StatusCode}.", (int)response.StatusCode);
            return null;
        }

        var payload = await response.Content.ReadFromJsonAsync<TokenPayload>(cancellationToken);
        return string.IsNullOrWhiteSpace(payload?.AccessToken) ? null : payload.AccessToken;
    }

    private static IResult RedirectError(AuthSettings settings, string code) =>
        Results.Redirect($"{settings.FrontendOrigin}/?authError={code}");

    private sealed record SignInCompletion(UserRow? User, bool PasswordAccount);

    private sealed record ProviderIdentity(string ProviderUserId, string Email, bool EmailVerified, string? DisplayName);

    private sealed record TokenPayload([property: JsonPropertyName("access_token")] string? AccessToken);

    private sealed record GoogleProfile(
        [property: JsonPropertyName("sub")] string? Subject,
        [property: JsonPropertyName("email")] string? Email,
        [property: JsonPropertyName("email_verified")] bool EmailVerified,
        [property: JsonPropertyName("name")] string? Name);

    private sealed record GitHubProfile(
        [property: JsonPropertyName("id")] long Id,
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("login")] string Login);

    private sealed record GitHubEmail(
        [property: JsonPropertyName("email")] string Email,
        [property: JsonPropertyName("primary")] bool Primary,
        [property: JsonPropertyName("verified")] bool Verified);
}
