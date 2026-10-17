using System.Net.Http.Json;
using System.Text.Json;

namespace ShuttleSync.Api.Support;

public sealed class ComebackCopy(IHttpClientFactory httpClientFactory, GeminiSettings settings)
{
    public async Task<(string Text, string Source)> WriteAsync(string venueName, int points, string reason, CancellationToken cancellationToken)
    {
        var fallback = $"We would love to see you back at {venueName}. {points} points are waiting and join your balance after your next completed visit.";
        if (!settings.IsConfigured)
        {
            return (fallback, "fallback");
        }

        var prompt = $"""
            Write one or two short sentences inviting a player back to {venueName}.
            Mention that {points} reward points are waiting and join their balance after their next completed visit there.
            They were chosen because: {reason}.
            Sound friendly and professional.
            Do not invent prices, policies, or other offers.
            Reply with the message only.
            """;
        var text = await GenerateAsync(new
        {
            contents = new[]
            {
                new { role = "user", parts = new[] { new { text = prompt } } },
            },
            generationConfig = new { thinkingConfig = new { thinkingBudget = 0 } },
        }, cancellationToken);
        if (string.IsNullOrWhiteSpace(text) || text.Length > 500)
        {
            return (fallback, "fallback");
        }

        return (text.Trim().Trim('"'), "gemini");
    }

    private async Task<string?> GenerateAsync(object payload, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("gemini");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://generativelanguage.googleapis.com/v1beta/models/{settings.Model}:generateContent");
        request.Headers.TryAddWithoutValidation("x-goog-api-key", settings.ApiKey);
        request.Content = JsonContent.Create(payload);
        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            return response.IsSuccessStatusCode ? ReadReply(json) : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }

    private static string? ReadReply(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (!document.RootElement.TryGetProperty("candidates", out var candidates))
            {
                return null;
            }

            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content) || !content.TryGetProperty("parts", out var parts))
                {
                    continue;
                }

                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var text) && text.GetString() is { Length: > 0 } value)
                    {
                        return value.Trim();
                    }
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }
}
