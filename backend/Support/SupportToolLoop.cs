using System.Net.Http.Json;
using System.Text.Json;

namespace ShuttleSync.Api.Support;

public sealed record SupportChatAction(
    string Kind,
    string Label,
    string? Href = null,
    string? Prompt = null,
    string? GroupId = null,
    string? SessionId = null,
    string? SocialId = null,
    string? CourtSummary = null,
    string? DateLabel = null,
    string? TimeLabel = null,
    string? Currency = null,
    decimal? Subtotal = null,
    decimal? DiscountAmount = null,
    decimal? PointsValue = null,
    decimal? CashAmount = null,
    string? PromoCode = null,
    bool? CanPayLater = null);

public sealed record SupportToolCall(string Name, JsonElement Args, JsonElement ModelPart = default);

public sealed record SupportToolExecutionResult(
    object Response,
    IReadOnlyList<SupportChatAction>? Actions = null);

public sealed record SupportToolLoopOutcome(
    string? Reply,
    IReadOnlyList<SupportChatAction> Actions);

public static class SupportToolLoop
{
    private const int MaxToolRounds = 4;

    public static async Task<SupportToolLoopOutcome> RunWithToolsAsync(
        IHttpClientFactory httpClientFactory,
        GeminiSettings settings,
        string systemInstruction,
        IReadOnlyList<(string Role, string Text)> historyTurns,
        object[] functionDeclarations,
        Func<SupportToolCall, CancellationToken, Task<SupportToolExecutionResult>> executeToolAsync,
        CancellationToken cancellationToken)
    {
        var contents = new List<object>(historyTurns.Count + MaxToolRounds * 2);
        foreach (var turn in historyTurns)
        {
            contents.Add(new
            {
                role = turn.Role == "assistant" ? "model" : "user",
                parts = new object[] { new { text = turn.Text } },
            });
        }

        var collectedActions = new List<SupportChatAction>();

        for (var round = 0; round <= MaxToolRounds; round++)
        {
            var payload = new
            {
                systemInstruction = new { parts = new[] { new { text = systemInstruction } } },
                contents,
                tools = functionDeclarations.Length > 0
                    ? new object[] { new { functionDeclarations } }
                    : null,
                generationConfig = new
                {
                    temperature = 0.35,
                    thinkingConfig = new { thinkingBudget = 0 },
                },
            };

            var rawJson = await SendGenerateContentAsync(httpClientFactory, settings, payload, cancellationToken);
            if (string.IsNullOrWhiteSpace(rawJson))
            {
                return new SupportToolLoopOutcome(null, collectedActions);
            }

            var calls = ExtractFunctionCalls(rawJson);
            if (calls.Count == 0 || round == MaxToolRounds)
            {
                var reply = ExtractTextReply(rawJson);
                return new SupportToolLoopOutcome(reply, DeduplicateActions(collectedActions));
            }

            var modelCallParts = new List<object>(calls.Count);
            var functionResponseParts = new List<object>(calls.Count);

            foreach (var call in calls)
            {
                modelCallParts.Add(call.ModelPart.ValueKind == JsonValueKind.Object
                    ? call.ModelPart
                    : new { functionCall = new { name = call.Name, args = call.Args } });

                var executed = await executeToolAsync(call, cancellationToken);
                if (executed.Actions is { Count: > 0 })
                {
                    collectedActions.AddRange(executed.Actions);
                }

                functionResponseParts.Add(BuildFunctionResponsePart(call.Name, executed.Response));
            }

            contents.Add(new
            {
                role = "model",
                parts = modelCallParts,
            });
            contents.Add(new
            {
                role = "user",
                parts = functionResponseParts,
            });
        }

        return new SupportToolLoopOutcome(null, DeduplicateActions(collectedActions));
    }

    public static IReadOnlyList<SupportToolCall> ExtractFunctionCalls(string payload)
    {
        var list = new List<SupportToolCall>();
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (!document.RootElement.TryGetProperty("candidates", out var candidates))
            {
                return list;
            }

            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content)
                    || !content.TryGetProperty("parts", out var parts))
                {
                    continue;
                }

                foreach (var part in parts.EnumerateArray())
                {
                    if (!part.TryGetProperty("functionCall", out var fnCall))
                    {
                        continue;
                    }

                    var name = fnCall.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (string.IsNullOrWhiteSpace(name))
                    {
                        continue;
                    }

                    var args = fnCall.TryGetProperty("args", out var a)
                        ? a.Clone()
                        : JsonDocument.Parse("{}").RootElement.Clone();
                    list.Add(new SupportToolCall(name.Trim(), args, part.Clone()));
                }

                if (list.Count > 0)
                {
                    break;
                }
            }
        }
        catch (JsonException)
        {
            return [];
        }

        return list;
    }

    public static object BuildFunctionResponsePart(string name, object result) => new
    {
        functionResponse = new
        {
            name,
            response = new
            {
                result,
            },
        },
    };

    public static string? ExtractTextReply(string payload)
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
                if (!candidate.TryGetProperty("content", out var content)
                    || !content.TryGetProperty("parts", out var parts))
                {
                    continue;
                }

                var builder = new List<string>();
                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var text) && text.GetString() is { Length: > 0 } value)
                    {
                        builder.Add(value.Trim());
                    }
                }

                if (builder.Count > 0)
                {
                    return string.Join("\n\n", builder).Trim();
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static async Task<string?> SendGenerateContentAsync(
        IHttpClientFactory httpClientFactory,
        GeminiSettings settings,
        object payload,
        CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("gemini");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(settings.Model)}:generateContent");
        request.Headers.TryAddWithoutValidation("x-goog-api-key", settings.ApiKey);
        request.Content = JsonContent.Create(payload);
        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            return await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            return null;
        }
    }

    private static IReadOnlyList<SupportChatAction> DeduplicateActions(List<SupportChatAction> actions)
    {
        if (actions.Count <= 1)
        {
            return actions;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var unique = new List<SupportChatAction>(actions.Count);
        foreach (var action in actions)
        {
            var key = $"{action.Kind}|{action.Label}|{action.Href}|{action.Prompt}|{action.GroupId}|{action.SessionId}";
            if (seen.Add(key))
            {
                unique.Add(action);
            }
        }

        return unique;
    }
}

