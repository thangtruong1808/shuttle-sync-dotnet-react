using System.Text.Json;

namespace ShuttleSync.Api.Auth;

public sealed class CsrfMiddleware(RequestDelegate next)
{
    private static readonly HashSet<string> ProtectedMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        HttpMethods.Post,
        HttpMethods.Put,
        HttpMethods.Patch,
        HttpMethods.Delete,
    };

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Path.StartsWithSegments("/api")
            && ProtectedMethods.Contains(context.Request.Method)
            && !IsValid(context))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                errors = new Dictionary<string, string[]>
                {
                    ["form"] = ["Invalid CSRF token."],
                },
            }));
            return;
        }

        await next(context);
    }

    private static bool IsValid(HttpContext context)
    {
        if (!AuthCookies.TryGetCsrf(context, out var cookie)
            || string.IsNullOrEmpty(cookie))
        {
            return false;
        }

        if (!context.Request.Headers.TryGetValue("X-CSRF-Token", out var headerValues))
        {
            return false;
        }

        var header = headerValues.ToString();
        return TokenProtection.FixedTimeEquals(cookie, header);
    }
}
