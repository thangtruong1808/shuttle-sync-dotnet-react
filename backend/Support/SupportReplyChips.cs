using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ShuttleSync.Api.Support;

internal sealed class SupportReplyProgress
{
    public bool Booking { get; private set; }
    public bool PayNowOnly { get; private set; }
    public List<string> PromoCodes { get; } = [];
    public List<SlotChoice> Slots { get; } = [];
    public int RewardPoints { get; private set; }
    public bool KnowsPoints { get; private set; }
    public string? PromoCode { get; private set; }
    public string? PromoDetail { get; private set; }
    public bool HoldSaved { get; private set; }

    public void Note(string tool, SupportToolExecutionResult result)
    {
        if (tool is "check_court_availability" or "suggest_alternative_slots" or "preview_booking_quote" or "list_active_promotions_and_socials" or "create_court_hold" or "join_public_social")
        {
            Booking = true;
        }

        if (tool == "create_court_hold" && Has(result.Response, "requiresPayNow"))
        {
            PayNowOnly = true;
        }

        if (tool == "create_court_hold" && Has(result.Response, "groupId") && !Has(result.Response, "error") && !Has(result.Response, "requiresPayNow"))
        {
            HoldSaved = true;
        }

        if (tool == "get_user_booking_context")
        {
            NotePoints(result.Response);
        }

        if (tool is "check_court_availability" or "suggest_alternative_slots")
        {
            Slots.Clear();
            Slots.AddRange(ReadSlots(result.Response));
        }

        if (tool == "list_active_promotions_and_socials")
        {
            foreach (var code in ReadCodes(result.Response))
            {
                if (!PromoCodes.Contains(code, StringComparer.OrdinalIgnoreCase))
                {
                    PromoCodes.Add(code);
                }
            }

            NotePromo(result.Response);
        }
    }

    private void NotePoints(object response)
    {
        var json = JsonSerializer.SerializeToElement(response);
        if (json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty("rewardPoints", out var points)
            && points.TryGetInt32(out var count))
        {
            RewardPoints = count;
            KnowsPoints = true;
        }
    }

    private void NotePromo(object response)
    {
        var json = JsonSerializer.SerializeToElement(response);
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("promotions", out var promotions) || promotions.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        var first = promotions.EnumerateArray().FirstOrDefault();
        if (first.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        PromoCode ??= Text(first, "code");
        if (PromoDetail is not null)
        {
            return;
        }

        var type = Text(first, "discountType");
        if (first.TryGetProperty("discountValue", out var value) && value.TryGetDecimal(out var amount) && type is not null)
        {
            PromoDetail = type.Equals("percent", StringComparison.OrdinalIgnoreCase)
                ? $"{amount:0.##}% off"
                : $"${amount:0.00} off";
        }
    }

    private static bool Has(object response, string name)
    {
        var json = JsonSerializer.SerializeToElement(response);
        return json.ValueKind == JsonValueKind.Object
            && json.TryGetProperty(name, out var value)
            && value.ValueKind is not JsonValueKind.Null and not JsonValueKind.False;
    }

    private static IEnumerable<string> ReadCodes(object response)
    {
        var json = JsonSerializer.SerializeToElement(response);
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("promotions", out var promotions) || promotions.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return promotions.EnumerateArray()
            .Select(item => item.TryGetProperty("code", out var code) ? code.GetString() : null)
            .Where(code => !string.IsNullOrWhiteSpace(code))
            .Select(code => code!.Trim())
            .Take(4);
    }

    private static IEnumerable<SlotChoice> ReadSlots(object response)
    {
        var json = JsonSerializer.SerializeToElement(response);
        if (json.ValueKind != JsonValueKind.Object)
        {
            return [];
        }

        var window = Text(json, "windowFormatted");
        var when = Text(json, "dateFormatted");
        if (!string.IsNullOrWhiteSpace(window)
            && json.TryGetProperty("availableCourts", out var courts)
            && courts.ValueKind == JsonValueKind.Array)
        {
            var choices = courts.EnumerateArray()
                .Select(court => Text(court, "courtName"))
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => SlotChoice.Create(name!, when, window))
                .Take(6)
                .ToArray();
            if (choices.Length > 0)
            {
                return choices;
            }
        }

        foreach (var key in new[] { "sampleAvailableWindows", "suggestedAlternatives", "suggestions" })
        {
            if (!json.TryGetProperty(key, out var list) || list.ValueKind != JsonValueKind.Array)
            {
                continue;
            }

            var choices = list.EnumerateArray()
                .Select(item =>
                {
                    var name = Text(item, "courtName") ?? Text(item, "CourtName");
                    var label = Text(item, "windowLabel") ?? Text(item, "WindowLabel");
                    var date = Text(item, "dateLabel") ?? Text(item, "DateLabel") ?? Text(item, "date") ?? Text(item, "Date");
                    return string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(label)
                        ? null
                        : SlotChoice.Create(name, date, label);
                })
                .Where(choice => choice is not null)
                .Select(choice => choice!)
                .Take(6)
                .ToArray();
            if (choices.Length > 0)
            {
                return choices;
            }
        }

        return [];
    }

    private static string? Text(JsonElement item, string name) =>
        item.ValueKind == JsonValueKind.Object
        && item.TryGetProperty(name, out var value)
        && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

internal sealed record SlotChoice(string Label, string Prompt)
{
    public static SlotChoice Create(string court, string? when, string window)
    {
        var time = EnglishWindow(window);
        var date = EnglishWhen(when);
        var label = $"{court.Trim()} · {time}";
        var prompt = string.IsNullOrWhiteSpace(date)
            ? $"Select {court.Trim()}, {time}"
            : $"Select {court.Trim()} on {date}, {time}";
        return new SlotChoice(label, prompt);
    }

    private static string EnglishWhen(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "";
        }

        var trimmed = raw.Trim();
        if (DateOnly.TryParseExact(trimmed, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var exact)
            || DateOnly.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out exact))
        {
            return exact.ToString("dddd, d MMMM yyyy", CultureInfo.InvariantCulture);
        }

        return trimmed;
    }

    private static string EnglishWindow(string window)
    {
        var trimmed = window.Trim();
        var match = Regex.Match(trimmed, @"^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})$");
        if (!match.Success
            || !TimeOnly.TryParseExact(match.Groups[1].Value, "H:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start)
            || !TimeOnly.TryParseExact(match.Groups[2].Value, "H:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var end))
        {
            return trimmed;
        }

        return $"{start.ToString("h:mm tt", CultureInfo.InvariantCulture)}–{end.ToString("h:mm tt", CultureInfo.InvariantCulture)}";
    }
}

internal readonly record struct SupportReplyPlan(IReadOnlyList<SupportChatAction> Actions, string? Reply);

internal static class SupportReplyChips
{
    public static SupportReplyPlan For(
        IReadOnlyList<(string Role, string Text)> turns,
        SupportReplyProgress progress,
        IReadOnlyList<SupportChatAction> actions,
        DateTime? nowLocal = null)
    {
        var said = string.Join('\n', turns.Where(turn => turn.Role == "user").Select(turn => turn.Text));
        var pickedSlot = PickedSlot(said);
        if ((!progress.Booking && !pickedSlot) || actions.Any(action => action.Kind == "stripe_checkout"))
        {
            return new SupportReplyPlan(actions, null);
        }

        var next = Next(said, progress, nowLocal);
        var kept = next.Any(action => action.Kind == "close_chat")
            ? actions.Where(action => action.Kind != "my_bookings_link").ToArray()
            : actions;
        var combined = next.Count == 0 ? kept : kept.Concat(next).ToArray();
        return new SupportReplyPlan(combined, GuidedReply(said, progress, nowLocal));
    }

    private static IReadOnlyList<SupportChatAction> Next(string said, SupportReplyProgress progress, DateTime? nowLocal)
    {
        var choseSchedule = Has(said, "one session") || Has(said, "1 week") || Has(said, "repeat weekly") || Has(said, "repeat this court");
        var promoSettled = Has(said, "without a promotion code or reward points")
            || Has(said, "apply the promotion code and redeem")
            || Has(said, "redeem my reward points")
            || Regex.IsMatch(said, @"\bApply promotion code\b", RegexOptions.IgnoreCase);
        var payingHere = Has(said, "pay from this chat");
        var chosePay = Has(said, "pay now") || (Has(said, "pay later") && !payingHere);
        var pickedSlot = PickedSlot(said);
        var payNowRequired = progress.PayNowOnly || StartsWithin24Hours(said, nowLocal);
        if (progress.HoldSaved && Has(said, "pay later") && !payingHere)
        {
            return
            [
                new SupportChatAction(Kind: "my_bookings_link", Label: "Pay in My Bookings", Href: "/profile/bookings"),
                Chip("Pay from this chat", "I want to pay from this chat"),
                new SupportChatAction(Kind: "close_chat", Label: "Finish chat"),
            ];
        }
        if (progress.Slots.Count > 0 && !pickedSlot)
        {
            return progress.Slots.Select(slot => Chip(slot.Label, slot.Prompt)).ToArray();
        }

        if (!pickedSlot)
        {
            return [];
        }

        if (!choseSchedule)
        {
            return
            [
                Chip("One session", "One session, just this time"),
                Chip("Hold for 1 week", "Hold this court for 1 week"),
                Chip("Repeat weekly", "Repeat this court weekly"),
            ];
        }

        if (!promoSettled)
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

        if (payingHere && !Has(said, "pay now"))
        {
            return [Chip("Pay now with Stripe", "Pay now with Stripe")];
        }

        if (payNowRequired)
        {
            return chosePay ? [] : [Chip("Pay now with Stripe", "Pay now with Stripe")];
        }

        return chosePay
            ? []
            :
            [
                Chip("Pay now with Stripe", "Pay now with Stripe"),
                Chip("Pay later (before 24h)", "Pay later, at least 24 hours before play"),
            ];
    }

    private static string? GuidedReply(string said, SupportReplyProgress progress, DateTime? nowLocal)
    {
        var pickedSlot = PickedSlot(said);
        var choseSchedule = Has(said, "one session") || Has(said, "1 week") || Has(said, "repeat weekly") || Has(said, "repeat this court");
        var promoSettled = Has(said, "without a promotion code or reward points")
            || Has(said, "apply the promotion code and redeem")
            || Has(said, "redeem my reward points")
            || Regex.IsMatch(said, @"\bApply promotion code\b", RegexOptions.IgnoreCase);
        if (progress.HoldSaved && Has(said, "pay later") && !Has(said, "pay from this chat"))
        {
            return "Your booking is held. You can pay later in My Bookings, pay from this chat, or finish chatting. Pay at least 24 hours before play, or the court is released.";
        }

        if (!pickedSlot || progress.PayNowOnly)
        {
            return null;
        }

        if (!choseSchedule)
        {
            return StartsWithin24Hours(said, nowLocal)
                ? "Would you like one session, a hold for 1 week, or a weekly repeat? This session starts within 24 hours, so it must be paid now. An unpaid hold lasts 30 minutes."
                : "Would you like one session, a hold for 1 week, or a weekly repeat?";
        }

        if (!promoSettled)
        {
            return PromoQuestion(progress);
        }

        return null;
    }

    private static string PromoQuestion(SupportReplyProgress progress)
    {
        var code = progress.PromoCode;
        var detail = progress.PromoDetail ?? "a discount";
        if (code is null)
        {
            return "Would you like to apply a promotion code, redeem reward points, or use both?";
        }

        return progress.KnowsPoints
            ? $"Would you like to apply the promotion code {code} for {detail}, redeem any of your {progress.RewardPoints.ToString(CultureInfo.InvariantCulture)} reward points ✨, or use both?"
            : $"Would you like to apply the promotion code {code} for {detail}, redeem reward points, or use both?";
    }

    private static bool PickedSlot(string said) =>
        Regex.IsMatch(said, @"\bSelect\b.+\d{1,2}:\d{2}", RegexOptions.IgnoreCase);

    private static bool StartsWithin24Hours(string said, DateTime? nowLocal)
    {
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
            return false;
        }

        return start <= nowLocal.Value.AddHours(24);
    }

    private static bool Has(string said, string phrase) =>
        said.Contains(phrase, StringComparison.OrdinalIgnoreCase);

    private static SupportChatAction Chip(string label, string prompt) =>
        new(Kind: "quick_replies", Label: label, Prompt: prompt);
}
