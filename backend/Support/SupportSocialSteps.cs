using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShuttleSync.Api.Support;

internal sealed record SocialChoice(string Label, string Prompt, string? SocialId, bool Full, DateTime? StartUtc, string? Status = null, string? PayHref = null)
{
    public bool Joined => Status is "confirmed" or "pending" or "waitlist";
}

internal readonly record struct SocialGuide(bool Handled, string? Reply);

internal static class SupportSocialSteps
{
    public static bool InFlow(string said) => Asked(said) || Picked(said) || AlreadyHave(said);

    public static bool NeedsSocialList(string said)
    {
        var last = LastLine(said);
        return Asked(last) && !Picked(last) && !AlreadyHave(last);
    }

    public static bool ReadyToPay(string said, IEnumerable<SocialChoice> socials)
    {
        var last = LastLine(said);
        if ((Asked(last) && !Picked(last)) || AlreadyHave(last))
        {
            return false;
        }

        var chosen = Chosen(said, socials);
        if (chosen?.Status is "confirmed" or "waitlist")
        {
            return false;
        }

        if (chosen?.Status == "pending" && !PayNow(last))
        {
            return false;
        }

        return InFlow(said) && Picked(said) && PromoSettled(said) && (PayNow(last) || PayLater(last));
    }

    public static SocialChoice? Selected(string said, IEnumerable<SocialChoice> socials) =>
        Match(LastLine(said), socials) ?? Match(said, socials);

    public static IEnumerable<SocialChoice> Read(object response)
    {
        var json = JsonSerializer.SerializeToElement(response);
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("socials", out var socials) || socials.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return socials.EnumerateArray()
            .Select(Map)
            .Where(choice => choice is not null)
            .Select(choice => choice!)
            .Take(8);
    }

    public static SupportChatAction[]? Actions(string said, SupportReplyProgress progress, DateTime? nowLocal)
    {
        if (!InFlow(said))
        {
            return null;
        }

        var last = LastLine(said);
        if (Asked(last) && !Picked(last) && !AlreadyHave(last))
        {
            return Open(progress, nowLocal).Select(social => Chip(social.Label, social.Prompt)).ToArray();
        }

        var taken = Chosen(said, progress.Socials);
        if (taken?.Joined == true || AlreadyHave(last))
        {
            return taken is { Status: "pending", PayHref: not null and not "" }
                ? [new SupportChatAction(Kind: "my_bookings_link", Label: "Pay for this social", Href: taken.PayHref, SocialId: taken.SocialId)]
                : [];
        }

        if (!Picked(said))
        {
            return Open(progress, nowLocal).Select(social => Chip(social.Label, social.Prompt)).ToArray();
        }

        if (!PromoSettled(said))
        {
            var code = progress.PromoCode;
            return
            [
                Chip("Use both", "Apply the promotion code and redeem my reward points"),
                Chip(code is null ? "Apply promo code" : $"Apply {code}", code is null ? "Apply the promotion code" : $"Apply promotion code {code}"),
                Chip("Use my points", "Redeem my reward points"),
                Chip("No thanks", "Continue without a promotion code or reward points"),
            ];
        }

        if (PayLater(said) && progress.SocialAlreadyJoined)
        {
            return [];
        }

        if (PayLater(said) && progress.SocialJoined)
        {
            return
            [
                Chip("Pay from this chat", "I want to pay from this chat"),
                new SupportChatAction(Kind: "close_chat", Label: "Finish chat"),
            ];
        }

        if (PayNow(said))
        {
            return [];
        }

        return Soon(said, nowLocal)
            ? [Chip("Pay now with Stripe", "Pay now with Stripe")]
            :
            [
                Chip("Pay now with Stripe", "Pay now with Stripe"),
                Chip("Pay later (before 24h)", "Pay later, at least 24 hours before play"),
            ];
    }

    public static SocialGuide Guide(string said, SupportReplyProgress progress, DateTime? nowLocal)
    {
        if (!InFlow(said))
        {
            return new SocialGuide(false, null);
        }

        var last = LastLine(said);
        if (Asked(last) && !Picked(last) && !AlreadyHave(last))
        {
            return new SocialGuide(true, Open(progress, nowLocal).Count == 0
                ? "No drop-in social is open yet."
                : "Please choose a social.");
        }

        var taken = Chosen(said, progress.Socials);
        if (taken?.Joined == true || AlreadyHave(last))
        {
            return new SocialGuide(true, TakenReply(taken));
        }

        if (!Picked(said))
        {
            return new SocialGuide(true, Open(progress, nowLocal).Count == 0
                ? "No drop-in social is open yet."
                : "Please choose a social.");
        }

        if (!PromoSettled(said))
        {
            return new SocialGuide(true, PromoQuestion(progress));
        }

        if (PayLater(said) && progress.SocialAlreadyJoined)
        {
            return new SocialGuide(true, "You already have a place in this social.");
        }

        if (PayLater(said) && progress.SocialJoined)
        {
            return new SocialGuide(true, "Your place is held. Please pay later in My Bookings, pay from this chat, or finish chatting. Pay at least 24 hours before play, or the place is released.");
        }

        if (PayNow(said))
        {
            if (!progress.SocialJoined)
            {
                return new SocialGuide(true, null);
            }

            return new SocialGuide(true, progress.SocialNeedsPayment
                ? "Please pay with Stripe. An unpaid place lasts 30 minutes."
                : "Your place is confirmed.");
        }

        return new SocialGuide(true, Soon(said, nowLocal)
            ? "This social starts within 24 hours, so it must be paid now. An unpaid place lasts 30 minutes."
            : "Please choose pay now, or pay later at least 24 hours before play.");
    }

    private static IReadOnlyList<SocialChoice> Open(SupportReplyProgress progress, DateTime? nowLocal) =>
        progress.Socials.Where(social => StillOpen(social.Prompt, nowLocal)).Take(8).ToArray();

    private static bool StillOpen(string prompt, DateTime? nowLocal)
    {
        if (nowLocal is null)
        {
            return true;
        }

        var match = Regex.Match(
            prompt,
            @"on\s+([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}),\s*\d{1,2}:\d{2}\s*[AP]M\s*[–-]\s*(\d{1,2}:\d{2}\s*[AP]M)",
            RegexOptions.IgnoreCase);
        if (!match.Success
            || !DateTime.TryParseExact(
                $"{match.Groups[1].Value} {match.Groups[2].Value}",
                "dddd, d MMMM yyyy h:mm tt",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var end))
        {
            return true;
        }

        return end > nowLocal.Value;
    }

    private static SocialChoice? Map(JsonElement item)
    {
        var when = Text(item, "dateFormatted");
        var window = Text(item, "windowFormatted");
        if (string.IsNullOrWhiteSpace(when) || string.IsNullOrWhiteSpace(window))
        {
            return null;
        }

        var full = item.TryGetProperty("isFull", out var flag) && flag.ValueKind == JsonValueKind.True;
        var status = Text(item, "yourStatus");
        var joined = status is "confirmed" or "pending" or "waitlist";
        var time = window.Trim();
        var date = when.Trim();
        var label = status switch
        {
            "confirmed" => $"{date} · {time} · Already registered",
            "pending" => $"{date} · {time} · Already held",
            "waitlist" => $"{date} · {time} · Already on the waitlist",
            _ => full ? $"{date} · {time} · Waitlist" : $"{date} · {time}",
        };
        var prompt = joined
            ? $"I already have a place in the social on {date}, {time}"
            : full
                ? $"Join the waitlist for the social on {date}, {time}"
                : $"Join the social on {date}, {time}";
        DateTime? start = null;
        if (item.TryGetProperty("startTime", out var raw) && raw.TryGetDateTime(out var parsed))
        {
            start = DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
        }

        return new SocialChoice(label, prompt, Text(item, "socialId"), full, start, status, Text(item, "payHref"));
    }

    private static SocialChoice? Chosen(string said, IEnumerable<SocialChoice> socials) =>
        Match(LastLine(said), socials) ?? Match(said, socials);

    private static SocialChoice? Match(string said, IEnumerable<SocialChoice> socials) =>
        socials.LastOrDefault(social =>
        {
            var parts = social.Label.Split(" · ", 3, StringSplitOptions.TrimEntries);
            var date = parts.ElementAtOrDefault(0);
            var time = parts.ElementAtOrDefault(1);
            return !string.IsNullOrWhiteSpace(date)
                && !string.IsNullOrWhiteSpace(time)
                && said.Contains(date, StringComparison.OrdinalIgnoreCase)
                && said.Contains(time, StringComparison.OrdinalIgnoreCase);
        });

    private static string LastLine(string said)
    {
        var lines = said.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return lines.Length == 0 ? "" : lines[^1];
    }

    private static bool AlreadyHave(string said) =>
        said.Contains("already have a place in the social", StringComparison.OrdinalIgnoreCase);

    private static string TakenReply(SocialChoice? social) => social?.Status switch
    {
        "pending" => "You already have a place held for this social. Please pay for it before it is released.",
        "waitlist" => "You are already on the waitlist for this social.",
        _ => "You already have a place in this social.",
    };

    private static bool PayFromChat(string said) =>
        said.Contains("pay from this chat", StringComparison.OrdinalIgnoreCase);

    private static bool PayNow(string said) =>
        said.Contains("pay now with stripe", StringComparison.OrdinalIgnoreCase) || PayFromChat(said);

    private static bool PayLater(string said) =>
        said.Contains("pay later", StringComparison.OrdinalIgnoreCase) && !PayFromChat(said);

    private static bool Soon(string said, DateTime? nowLocal)
    {
        if (said.Contains("Join the waitlist", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (nowLocal is null)
        {
            return false;
        }

        var match = Regex.Match(
            said,
            @"\bon\s+([A-Za-z]+,\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}),\s*(\d{1,2}:\d{2}\s*[AP]M)",
            RegexOptions.IgnoreCase);
        if (!match.Success
            || !DateTime.TryParseExact(
                $"{match.Groups[1].Value} {match.Groups[2].Value}",
                "dddd, d MMMM yyyy h:mm tt",
                CultureInfo.InvariantCulture,
                DateTimeStyles.None,
                out var start))
        {
            return true;
        }

        return start <= nowLocal.Value.AddHours(24);
    }

    private static string? Text(JsonElement item, string name) =>
        item.ValueKind == JsonValueKind.Object
        && item.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static bool Asked(string said) =>
        said.Contains("public social", StringComparison.OrdinalIgnoreCase)
        || said.Contains("join a social", StringComparison.OrdinalIgnoreCase)
        || said.Contains("drop-in", StringComparison.OrdinalIgnoreCase);

    private static bool Picked(string said) =>
        Regex.IsMatch(said, @"\bJoin the (?:waitlist for the )?social on\b", RegexOptions.IgnoreCase);

    private static bool PromoSettled(string said) =>
        said.Contains("without a promotion code or reward points", StringComparison.OrdinalIgnoreCase)
        || said.Contains("apply the promotion code and redeem", StringComparison.OrdinalIgnoreCase)
        || said.Contains("redeem my reward points", StringComparison.OrdinalIgnoreCase)
        || Regex.IsMatch(said, @"\bApply promotion code\b", RegexOptions.IgnoreCase);

    private static string PromoQuestion(SupportReplyProgress progress)
    {
        var code = progress.PromoCode;
        var detail = progress.PromoDetail ?? "a discount";
        if (code is null)
        {
            return "Please choose whether to apply a promotion code, redeem reward points, or use both.";
        }

        return progress.KnowsPoints
            ? $"Please choose whether to apply the promotion code {code} for {detail}, redeem any of your {progress.RewardPoints.ToString(CultureInfo.InvariantCulture)} reward points ✨, or use both."
            : $"Please choose whether to apply the promotion code {code} for {detail}, redeem reward points, or use both.";
    }

    private static SupportChatAction Chip(string label, string prompt) =>
        new(Kind: "quick_replies", Label: label, Prompt: prompt);
}
