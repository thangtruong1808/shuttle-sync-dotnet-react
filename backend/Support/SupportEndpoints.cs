using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using ShuttleSync.Api.Auth;
using ShuttleSync.Api.Booking;
using ShuttleSync.Api.Data;

namespace ShuttleSync.Api.Support;

public static class SupportEndpoints
{
    public static void MapSupportEndpoints(this WebApplication app)
    {
        app.MapPost("/api/support/chat", ChatAsync);
    }

    private static async Task<IResult> ChatAsync(
        ChatBody body,
        HttpContext http,
        GeminiSettings settings,
        AuthSettings authSettings,
        IHttpClientFactory httpClientFactory,
        AuthRepository authRepository,
        BookingRepository repository,
        DashboardRepository dashboardRepository,
        BookingPayments payments,
        SupportChatLimiter limiter,
        CancellationToken cancellationToken)
    {
        if (!settings.IsConfigured)
        {
            return Form("Support chat is not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        var address = ClientIpHelper.GetClientIp(http);
        if (!limiter.Permit(address))
        {
            return Form("Please wait a moment and try again.", StatusCodes.Status429TooManyRequests);
        }

        var turns = ReadTurns(body.Messages);
        string? transcript = null;
        if (!string.IsNullOrWhiteSpace(body.AudioBase64))
        {
            if (body.AudioBase64.Length > 1_500_000)
            {
                return Form("That recording is too long. Try a shorter question.", StatusCodes.Status400BadRequest);
            }

            var mimeType = AudioMime(body.MimeType);
            if (mimeType is null)
            {
                return Form("That recording format is not supported.", StatusCodes.Status400BadRequest);
            }

            transcript = await TranscribeAsync(httpClientFactory, settings, body.AudioBase64, mimeType, cancellationToken);
            if (transcript is null)
            {
                return Form("I could not hear that. Move closer and try again.", StatusCodes.Status502BadGateway);
            }

            turns = ReadTurns([.. turns, new ChatTurn("user", transcript)]);
        }

        if (turns.Length == 0 || turns[^1].Role != "user")
        {
            return Form(transcript is null ? "Type a question first." : "I could not hear that. Move closer and try again.", StatusCodes.Status400BadRequest);
        }

        var venueName = "this venue";
        VenueRow? venue = null;
        if (!string.IsNullOrWhiteSpace(body.VenueSlug))
        {
            venue = await repository.FindActiveVenueBySlugAsync(body.VenueSlug.Trim(), cancellationToken);
            if (venue is not null)
            {
                venueName = venue.Name;
            }
        }

        var history = turns.Select(turn => (turn.Role ?? "user", turn.Text ?? "")).ToArray();
        var progress = new SupportReplyProgress();
        var outcome = await SupportToolLoop.RunWithToolsAsync(
            httpClientFactory,
            settings,
            SupportAgentPrompt.Build(venueName, venue?.Slug, body.Date),
            history,
            [.. SupportDiscoveryTools.Declarations, .. SupportBookingTools.Declarations],
            (call, token) => ExecuteToolAsync(call, http, authRepository, repository, dashboardRepository, payments, authSettings, venue, body.Date, progress, token),
            cancellationToken);
        DateTime? nowLocal = null;
        if (venue is not null && SupportDiscoveryShared.TryGetZone(venue.TimeZone, out var zone))
        {
            nowLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone);
        }

        var plan = SupportReplyChips.For(history, progress, outcome.Actions, nowLocal);
        var actions = plan.Actions;
        var reply = plan.Reply
            ?? (string.IsNullOrWhiteSpace(outcome.Reply) ? actions.Count > 0 ? "Here is the next step." : null : outcome.Reply);
        if (reply is null)
        {
            return Form("Support chat could not answer just now.", StatusCodes.Status502BadGateway);
        }

        return Results.Ok(new { reply, transcript, actions });
    }

    private static async Task<SupportToolExecutionResult> ExecuteToolAsync(
        SupportToolCall call,
        HttpContext http,
        AuthRepository authRepository,
        BookingRepository repository,
        DashboardRepository dashboardRepository,
        BookingPayments payments,
        AuthSettings authSettings,
        VenueRow? venue,
        string? pageDate,
        SupportReplyProgress progress,
        CancellationToken cancellationToken)
    {
        var found = await SupportDiscoveryTools.TryExecuteAsync(call, http, authRepository, repository, venue, pageDate, cancellationToken)
            ?? await SupportBookingTools.TryExecuteAsync(call, http, authRepository, repository, dashboardRepository, payments, authSettings, venue, pageDate, cancellationToken);
        found ??= new SupportToolExecutionResult(new { error = "That action is not available." });
        progress.Note(call.Name, found);
        return found;
    }

    private static async Task<string?> TranscribeAsync(
        IHttpClientFactory httpClientFactory,
        GeminiSettings settings,
        string audioBase64,
        string mimeType,
        CancellationToken cancellationToken)
    {
        var heard = await GenerateAsync(httpClientFactory, settings, new
        {
            contents = new[]
            {
                new
                {
                    role = "user",
                    parts = new object[]
                    {
                        new { inlineData = new { mimeType, data = audioBase64 } },
                        new { text = "Write only the words spoken in this recording. If there is no speech, reply with exactly [silence]." },
                    },
                },
            },
            generationConfig = new { thinkingConfig = new { thinkingBudget = 0 } },
        }, cancellationToken);
        if (string.IsNullOrWhiteSpace(heard))
        {
            return null;
        }

        var transcript = heard.Trim().Trim('"');
        return transcript.Equals("[silence]", StringComparison.OrdinalIgnoreCase) ? null : transcript;
    }

    private static async Task<string?> GenerateAsync(
        IHttpClientFactory httpClientFactory,
        GeminiSettings settings,
        object payload,
        CancellationToken cancellationToken)
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

    private static ChatTurn[] ReadTurns(IEnumerable<ChatTurn?>? messages) =>
        (messages ?? [])
            .Where(turn => turn?.Role is "user" or "assistant" && !string.IsNullOrWhiteSpace(turn.Text))
            .TakeLast(14)
            .Select(turn => new ChatTurn(turn!.Role!, turn.Text!.Trim()[..Math.Min(turn.Text.Trim().Length, 800)]))
            .ToArray();

    private static string? AudioMime(string? mimeType)
    {
        var mime = mimeType?.Split(';')[0].Trim().ToLowerInvariant();
        return mime is "audio/webm" or "audio/mp4" or "audio/mpeg" or "audio/wav" or "audio/ogg" or "audio/aac" ? mime : null;
    }

    public static bool TryReadWindow(string question, out TimeOnly start, out TimeOnly end)
    {
        start = default;
        end = default;
        var pair = Regex.Match(
            question,
            @"\b(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:to|until|–|—|-)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\b",
            RegexOptions.IgnoreCase);
        if (!pair.Success || !TryClock(pair.Groups[1].Value, out var startHour, out var startMinute, out var startMeridian) || !TryClock(pair.Groups[2].Value, out var endHour, out var endMinute, out var endMeridian))
        {
            return false;
        }

        var effectiveStartMeridian = startMeridian;
        var effectiveEndMeridian = endMeridian;
        if (effectiveStartMeridian is null && effectiveEndMeridian == "pm" && startHour is >= 6 and <= 11 && endHour is >= 1 and <= 5)
        {
            effectiveStartMeridian = "am";
        }
        else
        {
            var shared = startMeridian ?? endMeridian;
            effectiveStartMeridian ??= shared;
            effectiveEndMeridian ??= shared;
        }

        var startResolved = ResolveHour(startHour, effectiveStartMeridian);
        var endResolved = ResolveHour(endHour, effectiveEndMeridian);
        if (startResolved is >= 12 && endMeridian is null && endResolved is >= 1 and <= 11)
        {
            endResolved += 12;
        }

        if (endResolved == 12 && startResolved > 12)
        {
            endResolved = 0;
        }

        if (startResolved is null || endResolved is null)
        {
            return false;
        }

        start = new TimeOnly(startResolved.Value, startMinute);
        end = new TimeOnly(endResolved.Value, endMinute);
        return true;
    }

    private static bool TryClock(string raw, out int hour, out int minute, out string? meridian)
    {
        hour = 0;
        minute = 0;
        meridian = null;
        var match = Regex.Match(raw.Trim(), @"^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$", RegexOptions.IgnoreCase);
        if (!match.Success || !int.TryParse(match.Groups[1].Value, out hour))
        {
            return false;
        }

        minute = match.Groups[2].Success && int.TryParse(match.Groups[2].Value, out var parsedMinute) ? parsedMinute : 0;
        if (hour > 23 || minute > 59)
        {
            return false;
        }

        if (match.Groups[3].Success)
        {
            meridian = match.Groups[3].Value.StartsWith('p') || match.Groups[3].Value.StartsWith('P') ? "pm" : "am";
        }

        return true;
    }

    private static int? ResolveHour(int hour, string? meridian)
    {
        if (meridian is null)
        {
            if (hour is < 0 or > 23)
            {
                return null;
            }

            if (hour is >= 6 and <= 11)
            {
                return hour;
            }

            return hour is >= 1 and <= 5 ? hour + 12 : hour;
        }

        if (hour is < 1 or > 12)
        {
            return hour <= 23 ? hour : null;
        }

        if (hour == 12)
        {
            return meridian == "pm" ? 12 : 0;
        }

        return meridian == "pm" ? hour + 12 : hour;
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

    private static IResult Form(string message, int status) =>
        Results.Json(new { errors = new Dictionary<string, string[]> { ["form"] = [message] } }, statusCode: status);

    private sealed record ChatBody(string? VenueSlug, string? Date, ChatTurn[]? Messages, string? AudioBase64 = null, string? MimeType = null);

    private sealed record ChatTurn(string? Role, string? Text);
}

public sealed class SupportChatLimiter
{
    private const int MaxKeys = 4096;
    private readonly Dictionary<string, Queue<DateTimeOffset>> _hits = new(StringComparer.Ordinal);
    private readonly Lock _gate = new();

    public bool Permit(string key)
    {
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddMinutes(-1);
        lock (_gate)
        {
            if (_hits.Count >= MaxKeys && !_hits.ContainsKey(key))
            {
                var emptyKeys = new List<string>();
                foreach (var (existingKey, queue) in _hits)
                {
                    while (queue.Count > 0 && queue.Peek() < cutoff)
                    {
                        queue.Dequeue();
                    }

                    if (queue.Count == 0)
                    {
                        emptyKeys.Add(existingKey);
                    }
                }

                foreach (var emptyKey in emptyKeys)
                {
                    _hits.Remove(emptyKey);
                }

                if (_hits.Count >= MaxKeys)
                {
                    var oldestKey = _hits.Keys.FirstOrDefault();
                    if (oldestKey is not null)
                    {
                        _hits.Remove(oldestKey);
                    }
                }
            }

            if (!_hits.TryGetValue(key, out var hits))
            {
                hits = new Queue<DateTimeOffset>();
                _hits[key] = hits;
            }

            while (hits.Count > 0 && hits.Peek() < cutoff)
            {
                hits.Dequeue();
            }

            if (hits.Count >= 8)
            {
                return false;
            }

            hits.Enqueue(now);
            return true;
        }
    }
}
