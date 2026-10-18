using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ShuttleSync.Api.Data;
using ShuttleSync.Api.Support;

namespace ShuttleSync.Api.Booking;

public sealed record WeekSlotFact(string Date, string Start, string End, string Label);

public sealed record WeekFacts(string Code, string[] Courts, string When, WeekSlotFact[] Alternatives, decimal? Difference);

public sealed class WeekChangeResult
{
    public bool Ok { get; init; }
    public string Code { get; init; } = "";
    public string Fallback { get; init; } = "";
    public WeekFacts Facts { get; init; } = new("", [], "", [], null);
    public decimal TopUpAmount { get; init; }
    public Guid[] AddedBookingIds { get; init; } = [];
    public bool PayNow { get; init; }
    public Guid[] PayBookingIds { get; init; } = [];
    public decimal Paid { get; init; }
    public decimal Quote { get; init; }
    public decimal Difference { get; init; }
    public CourtRefundDue[] Refunds { get; init; } = [];
}

public static class WeekChangeText
{
    public static string Template(WeekFacts facts)
    {
        var court = facts.Courts.FirstOrDefault() ?? "That court";
        var extra = facts.Alternatives.Length == 0 ? "" : $" You can try {string.Join(", ", facts.Alternatives.Select(slot => slot.Label))}.";
        return facts.Code switch
        {
            "SLOT_TAKEN" => $"{court} was just taken for that time. Choose another time.{extra}",
            "HELD_FOR_RECURRING" => $"{court} is held for a later week because you keep weeks ahead. Choose another time, or cancel that held week and book again.",
            "OUTSIDE_POLICY_WINDOW" => "This session starts within 24 hours, so it cannot be saved unpaid. Pay for it when you register, or choose a later time.",
            "COURT_UNAVAILABLE" => $"{court} is closed or not available then.{extra}",
            "PRICE_INCREASE" => "The new time costs more than you already paid. Stay at the current time, or accept the difference before this week moves.",
            "PRICE_DECREASE" => "The new time costs less than you already paid. Stay at the current time, or agree to the refund before these hours change.",
            "ALL_COURTS_BOOKED" => "All courts are booked for this week.",
            _ => "That change could not be saved. Choose another time.",
        };
    }

    public static WeekFacts Facts(string code, IEnumerable<string> courts, string when, IEnumerable<WeekSlotFact> alternatives, decimal? difference) =>
        new(code, courts.Where(court => court.Length > 0).Distinct().Take(4).ToArray(), when, alternatives.Take(3).ToArray(), difference);
}

public sealed class WeekChangeCopy(IHttpClientFactory httpClientFactory, GeminiSettings settings)
{
    private readonly ConcurrentDictionary<string, string> _cache = new();
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _hits = new();

    public async Task<(string Message, string Source)> PhraseAsync(Guid userId, WeekFacts facts, CancellationToken cancellationToken)
    {
        var fallback = WeekChangeText.Template(facts);
        if (!Permit(userId) || !settings.IsConfigured)
        {
            return (fallback, "fallback");
        }

        var key = CacheKey(facts);
        if (_cache.TryGetValue(key, out var cached))
        {
            return (cached, "gemini");
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        var allowed = AllowedTimes(facts);
        var prompt = $"""
            Rewrite this booking note in one or two short, friendly sentences.
            Reason: {facts.Code}.
            Courts: {string.Join(", ", facts.Courts)}.
            Time: {facts.When}.
            Other times the player can pick: {string.Join("; ", facts.Alternatives.Select(slot => slot.Label))}.
            Use only those courts and times.
            Do not mention a price, a dollar amount, or any time that is not listed.
            Reply with the message only.
            """;
        var text = await GenerateAsync(prompt, timeout.Token);
        if (!Valid(text, allowed))
        {
            return (fallback, "fallback");
        }

        var clean = text!.Trim().Trim('"');
        _cache[key] = clean;
        return (clean, "gemini");
    }

    private bool Permit(Guid userId)
    {
        var now = DateTimeOffset.UtcNow;
        var hits = _hits.GetOrAdd(userId.ToString(), _ => new Queue<DateTimeOffset>());
        lock (hits)
        {
            while (hits.Count > 0 && hits.Peek() < now.AddMinutes(-1))
            {
                hits.Dequeue();
            }

            if (hits.Count >= 20)
            {
                return false;
            }

            hits.Enqueue(now);
            return true;
        }
    }

    private static string CacheKey(WeekFacts facts)
    {
        var raw = JsonSerializer.Serialize(new
        {
            facts.Code,
            locale = "en",
            courts = facts.Courts.OrderBy(court => court),
            when = facts.When,
            alternatives = facts.Alternatives.Select(slot => slot.Label).OrderBy(label => label),
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(raw)));
    }

    private static HashSet<string> AllowedTimes(WeekFacts facts)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Collect(facts.When, allowed);
        foreach (var slot in facts.Alternatives)
        {
            Collect(slot.Label, allowed);
            if (slot.Start.Length > 0) allowed.Add(slot.Start);
            if (slot.End.Length > 0) allowed.Add(slot.End);
        }

        return allowed;
    }

    private static void Collect(string text, HashSet<string> allowed)
    {
        foreach (Match match in ClockPattern().Matches(text))
        {
            allowed.Add(match.Value);
        }
    }

    private static bool Valid(string? text, HashSet<string> allowed)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 240)
        {
            return false;
        }

        if (text.Contains('$') || PricePattern().IsMatch(text))
        {
            return false;
        }

        foreach (Match match in ClockPattern().Matches(text))
        {
            if (!allowed.Contains(match.Value))
            {
                return false;
            }
        }

        return true;
    }

    private async Task<string?> GenerateAsync(string prompt, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("gemini");
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://generativelanguage.googleapis.com/v1beta/models/{settings.Model}:generateContent");
        request.Headers.TryAddWithoutValidation("x-goog-api-key", settings.ApiKey);
        request.Content = JsonContent.Create(new
        {
            contents = new[] { new { role = "user", parts = new[] { new { text = prompt } } } },
            generationConfig = new { thinkingConfig = new { thinkingBudget = 0 } },
        });
        try
        {
            using var response = await client.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
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
                        return value;
                    }
                }
            }
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or OperationCanceledException)
        {
            return null;
        }

        return null;
    }

    private static Regex ClockPattern() => new(@"\b\d{1,2}:\d{2}\s*(?:am|pm)?\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static Regex PricePattern() => new(@"\b\d+\.\d{2}\b", RegexOptions.Compiled);
}
