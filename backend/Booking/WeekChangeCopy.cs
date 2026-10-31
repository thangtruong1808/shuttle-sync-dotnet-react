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
    private static readonly HashSet<string> AllowedCodes = new(StringComparer.Ordinal)
    {
        "SLOT_TAKEN",
        "HELD_FOR_RECURRING",
        "OUTSIDE_POLICY_WINDOW",
        "COURT_UNAVAILABLE",
        "PRICE_INCREASE",
        "PRICE_DECREASE",
        "ALL_COURTS_BOOKED",
    };

    public static bool IsAllowedCode(string? code) =>
        !string.IsNullOrWhiteSpace(code) && AllowedCodes.Contains(code.Trim());

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
        new(
            CleanText(code, 40),
            courts
                .Select(court => CleanText(court, 80))
                .Where(court => court.Length > 0)
                .Distinct()
                .Take(4)
                .ToArray(),
            CleanText(when, 80),
            alternatives
                .Where(slot => slot is not null)
                .Select(slot => new WeekSlotFact(
                    CleanText(slot.Date, 80),
                    CleanText(slot.Start, 80),
                    CleanText(slot.End, 80),
                    CleanText(slot.Label, 80)))
                .Where(slot => slot.Label.Length > 0)
                .Take(3)
                .ToArray(),
            difference);

    private static string CleanText(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var cleaned = new string(value.Trim().Where(ch => !char.IsControl(ch)).ToArray());
        return cleaned.Length <= maxLength ? cleaned : cleaned[..maxLength];
    }
}

public sealed class WeekChangeCopy(IHttpClientFactory httpClientFactory, GeminiSettings settings)
{
    private const int MaxCacheEntries = 512;
    private const int MaxHitKeys = 2048;
    private readonly ConcurrentDictionary<string, string> _cache = new();
    private readonly Dictionary<string, Queue<DateTimeOffset>> _hits = new(StringComparer.Ordinal);
    private readonly Lock _gate = new();

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
        if (_cache.Count >= MaxCacheEntries)
        {
            _cache.Clear();
        }

        _cache[key] = clean;
        return (clean, "gemini");
    }

    private bool Permit(Guid userId)
    {
        var key = userId.ToString();
        var now = DateTimeOffset.UtcNow;
        var cutoff = now.AddMinutes(-1);
        lock (_gate)
        {
            if (_hits.Count >= MaxHitKeys && !_hits.ContainsKey(key))
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

                if (_hits.Count >= MaxHitKeys)
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
