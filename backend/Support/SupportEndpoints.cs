using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
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
        IHttpClientFactory httpClientFactory,
        BookingRepository repository,
        SupportChatLimiter limiter,
        CancellationToken cancellationToken)
    {
        if (!settings.IsConfigured)
        {
            return Form("Support chat is not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        var address = http.Connection.RemoteIpAddress?.ToString() ?? "unknown";
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
        var schedule = "No live court schedule was loaded. If they ask which court is free, say you cannot see that venue and point them to Book a court.";
        if (!string.IsNullOrWhiteSpace(body.VenueSlug))
        {
            var venue = await repository.FindActiveVenueBySlugAsync(body.VenueSlug.Trim(), cancellationToken);
            if (venue is not null)
            {
                venueName = venue.Name;
                schedule = await ScheduleAsync(repository, venue, body.Date, turns[^1].Text ?? "", cancellationToken);
            }
        }

        var direct = DirectReply(schedule);
        if (direct is not null)
        {
            return Results.Ok(new { reply = direct, transcript });
        }

        var reply = await GenerateAsync(httpClientFactory, settings, new
        {
            systemInstruction = new { parts = new[] { new { text = Brief(venueName, schedule) } } },
            contents = turns.Select(turn => new
            {
                role = turn.Role == "assistant" ? "model" : "user",
                parts = new[] { new { text = turn.Text } },
            }),
            generationConfig = new { thinkingConfig = new { thinkingBudget = 0 } },
        }, cancellationToken);
        if (string.IsNullOrWhiteSpace(reply))
        {
            return Form("Support chat could not answer just now.", StatusCodes.Status502BadGateway);
        }

        return Results.Ok(new { reply, transcript });
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
            .TakeLast(8)
            .Select(turn => new ChatTurn(turn!.Role!, turn.Text!.Trim()[..Math.Min(turn.Text.Trim().Length, 800)]))
            .ToArray();

    private static string? AudioMime(string? mimeType)
    {
        var mime = mimeType?.Split(';')[0].Trim().ToLowerInvariant();
        return mime is "audio/webm" or "audio/mp4" or "audio/mpeg" or "audio/wav" or "audio/ogg" or "audio/aac" ? mime : null;
    }

    private static async Task<string> ScheduleAsync(
        BookingRepository repository,
        VenueRow venue,
        string? pageDate,
        string question,
        CancellationToken cancellationToken)
    {
        TimeZoneInfo zone;
        try
        {
            zone = TimeZoneInfo.FindSystemTimeZoneById(venue.TimeZone);
        }
        catch (TimeZoneNotFoundException)
        {
            return "The venue timezone could not be read. Point them to Book a court.";
        }

        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone));
        var date = DateOnly.TryParse(pageDate, out var parsedPage) ? parsedPage : today;
        if (Regex.IsMatch(question, @"\btoday\b", RegexOptions.IgnoreCase))
        {
            date = today;
        }

        if (Regex.IsMatch(question, @"\btomorrow\b", RegexOptions.IgnoreCase))
        {
            date = today.AddDays(1);
        }

        var namedDay = Regex.Match(question, @"\b(20\d{2}-\d{2}-\d{2})\b");
        if (namedDay.Success && DateOnly.TryParse(namedDay.Value, out var named))
        {
            date = named;
        }

        var dayStartUtc = TimeZoneInfo.ConvertTimeToUtc(date.ToDateTime(TimeOnly.MinValue), zone);
        var dayEndUtc = TimeZoneInfo.ConvertTimeToUtc(date.AddDays(1).ToDateTime(TimeOnly.MinValue), zone);
        var sessions = await repository.ListSupportSessionsAsync(venue.Id, dayStartUtc, dayEndUtc, cancellationToken);
        var closures = await repository.ListPublicClosuresAsync(venue.Id, dayStartUtc, dayEndUtc, cancellationToken);
        var courts = await repository.ListPublicCourtsAsync(venue.Id, cancellationToken);
        var nowLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, zone);
        var lines = new List<string>
        {
            $"Now: {nowLocal.ToString("dddd d MMMM yyyy, h:mm tt", CultureInfo.InvariantCulture)} ({venue.TimeZone}).",
            $"Hourly rate: {venue.Currency} ${venue.HourlyRate:0.00}.",
            $"Schedule date: {date.ToString("dddd d MMMM yyyy", CultureInfo.InvariantCulture)}.",
        };

        if (!TryReadWindow(question, out var startClock, out var endClock))
        {
            lines.Add("No exact time range was asked. Occupied times below are the only blocks. A court is free only when the asked time does not overlap them and starts in the future for at least 30 minutes.");
            foreach (var court in courts)
            {
                lines.Add(CourtBlocks(court, sessions, closures, zone));
            }

            return string.Join('\n', lines);
        }

        var startLocal = date.ToDateTime(startClock);
        var endLocal = date.ToDateTime(endClock);
        if (endLocal <= startLocal)
        {
            endLocal = endLocal.AddDays(1);
        }

        var startUtc = TimeZoneInfo.ConvertTimeToUtc(startLocal, zone);
        var endUtc = TimeZoneInfo.ConvertTimeToUtc(endLocal, zone);
        if (endUtc > dayEndUtc || startUtc < dayStartUtc)
        {
            sessions = await repository.ListSupportSessionsAsync(venue.Id, startUtc, endUtc, cancellationToken);
            closures = await repository.ListPublicClosuresAsync(venue.Id, startUtc, endUtc, cancellationToken);
        }

        lines.Add($"Checked window: {FormatLocal(startUtc, zone)}–{FormatLocal(endUtc, zone)}.");
        if (endUtc - startUtc < TimeSpan.FromMinutes(30))
        {
            lines.Add("That window is shorter than 30 minutes, so it cannot be booked.");
            return string.Join('\n', lines);
        }

        if (startUtc <= DateTime.UtcNow)
        {
            lines.Add("That start time is already in the past, so it cannot be booked. Tell them to pick a later start.");
            return string.Join('\n', lines);
        }

        var minutes = (decimal)(endUtc - startUtc).TotalMinutes;
        var estimate = decimal.Round(venue.HourlyRate * minutes / 60m, 2, MidpointRounding.AwayFromZero);
        var available = new List<string>();
        var blocked = new List<string>();
        foreach (var court in courts)
        {
            var reason = BlockReason(court.Id, startUtc, endUtc, sessions, closures, zone);
            var label = CourtLabel(court);
            if (reason is null)
            {
                var exact = sessions.FirstOrDefault(session =>
                    session.CourtId == court.Id
                    && session.Taken == 0
                    && SameInstant(session.StartTime, startUtc)
                    && SameInstant(session.EndTime, endUtc));
                var price = exact is null ? estimate : exact.Price;
                available.Add(venue.HourlyRate <= 0 && exact is null
                    ? label
                    : $"{label} (about {venue.Currency} ${price:0.00} before points or a promotion code)");
            }
            else
            {
                blocked.Add($"{label}: {reason}");
            }
        }

        lines.Add(available.Count == 0 ? "Available: none." : "Available: " + string.Join(", ", available) + ".");
        lines.Add(blocked.Count == 0 ? "Unavailable: none." : "Unavailable: " + string.Join("; ", blocked) + ".");
        lines.Add("Answer this window from the Available and Unavailable lines only.");
        return string.Join('\n', lines);
    }

    private static string? DirectReply(string schedule)
    {
        foreach (var line in schedule.Split('\n'))
        {
            if (line.StartsWith("That start time is already in the past", StringComparison.Ordinal))
            {
                return "That start time has already passed. Choose a later start with Book a court.";
            }

            if (line.StartsWith("That window is shorter than 30 minutes", StringComparison.Ordinal))
            {
                return "Please choose at least 30 minutes. You can set the time with Book a court.";
            }
        }

        var available = schedule.Split('\n').FirstOrDefault(line => line.StartsWith("Available: ", StringComparison.Ordinal));
        var window = schedule.Split('\n').FirstOrDefault(line => line.StartsWith("Checked window: ", StringComparison.Ordinal));
        if (available is null || window is null)
        {
            return null;
        }

        var when = window["Checked window: ".Length..].Trim().TrimEnd('.');
        var free = available["Available: ".Length..].Trim().TrimEnd('.');
        var blockedLine = schedule.Split('\n').FirstOrDefault(line => line.StartsWith("Unavailable: ", StringComparison.Ordinal));
        var busy = blockedLine is null ? "" : blockedLine["Unavailable: ".Length..].Trim().TrimEnd('.');
        if (free == "none")
        {
            var why = busy is "" or "none" ? "" : $" {busy}.";
            return $"No court is free from {when}.{why} Try another time with Book a court.";
        }

        var note = busy is "" or "none" ? "" : $" Not free: {busy}.";
        return $"From {when}, you can book {free}.{note} Open Book a court to hold one.";
    }

    private static string CourtBlocks(PublicCourtRow court, SupportSessionRow[] sessions, PublicClosureRow[] closures, TimeZoneInfo zone)
    {
        var blocks = sessions
            .Where(session => session.CourtId == court.Id)
            .Select(session => $"{FormatLocal(session.StartTime, zone)}–{FormatLocal(session.EndTime, zone)}")
            .Concat(closures
                .Where(closure => closure.CourtId is null || closure.CourtId == court.Id)
                .Select(closure => $"closed {FormatLocal(closure.StartTime, zone)}–{FormatLocal(closure.EndTime, zone)}"))
            .ToArray();
        return $"{CourtLabel(court)}: {(blocks.Length == 0 ? "nothing booked or closed" : string.Join(", ", blocks))}.";
    }

    private static string? BlockReason(
        Guid courtId,
        DateTime startUtc,
        DateTime endUtc,
        SupportSessionRow[] sessions,
        PublicClosureRow[] closures,
        TimeZoneInfo zone)
    {
        var closure = closures.FirstOrDefault(item =>
            (item.CourtId is null || item.CourtId == courtId) && Overlaps(item.StartTime, item.EndTime, startUtc, endUtc));
        if (closure is not null)
        {
            return $"closed {FormatLocal(closure.StartTime, zone)}–{FormatLocal(closure.EndTime, zone)}";
        }

        foreach (var session in sessions.Where(item => item.CourtId == courtId && Overlaps(item.StartTime, item.EndTime, startUtc, endUtc)))
        {
            var exact = SameInstant(session.StartTime, startUtc) && SameInstant(session.EndTime, endUtc);
            if (exact && session.Taken == 0)
            {
                continue;
            }

            return $"{FormatLocal(session.StartTime, zone)}–{FormatLocal(session.EndTime, zone)} is already on the schedule";
        }

        return null;
    }

    private static bool TryReadWindow(string question, out TimeOnly start, out TimeOnly end)
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

        var shared = startMeridian ?? endMeridian;
        var startResolved = ResolveHour(startHour, startMeridian ?? shared);
        var endResolved = ResolveHour(endHour, endMeridian ?? shared);
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
            return hour <= 23 ? hour == 12 || hour > 12 ? hour : hour + 12 : null;
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

    private static string CourtLabel(PublicCourtRow court) =>
        string.IsNullOrWhiteSpace(court.CourtName) ? $"Court {court.CourtNumber}" : court.CourtName.Trim();

    private static string FormatLocal(DateTime utc, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), zone).ToString("h:mm tt", CultureInfo.InvariantCulture);

    private static bool Overlaps(DateTime leftStart, DateTime leftEnd, DateTime rightStart, DateTime rightEnd) =>
        Stamp(leftStart) < Stamp(rightEnd) && Stamp(leftEnd) > Stamp(rightStart);

    private static bool SameInstant(DateTime left, DateTime right) =>
        Math.Abs((Stamp(left) - Stamp(right)).TotalSeconds) < 1;

    private static DateTime Stamp(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static string Brief(string venueName, string schedule) =>
        $"""
        You are the Shuttle Sync support assistant for {venueName}.
        Answer only about booking a badminton court on this site. Be short, warm, and plain. Do not use markdown.
        When the live schedule lists available courts, name those courts, the time, and the price. Never say you lack access to court availability when that schedule is present.
        Do not invent a court, a time, a price, or a person's booking. If the schedule does not cover what they asked, say so and point them to Book a court or View my bookings.
        Live schedule:
        {schedule}
        Rules:
        A player picks a court and a future time of at least 30 minutes. The price is the venue hourly rate. An overlapping booking, an existing session, or a closure means that time is not available.
        Payment happens on Stripe's page with card, Apple Pay, Google Pay, BECS direct debit, or PayTo. Reward points can cover part or all of the price. Any cash left must be $0 or at least $0.50.
        Promotion codes can be used any number of times while they are active and inside their valid-from and valid-to dates.
        A booking can be cancelled before the session starts. More than 24 hours before the start, the payment is refunded in full and points come back. Within 24 hours, the venue keeps its late-cancel percent of the cash and the same share of the points.
        Reward points are added after the booked session ends, when that day is inside an active venue incentive.
        """;

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
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _hits = new();

    public bool Permit(string key)
    {
        var now = DateTimeOffset.UtcNow;
        var hits = _hits.GetOrAdd(key, _ => new Queue<DateTimeOffset>());
        lock (hits)
        {
            while (hits.Count > 0 && hits.Peek() < now.AddMinutes(-1))
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
