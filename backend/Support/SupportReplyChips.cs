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
    public bool NeedsDuration { get; private set; }
    public bool NeedsStartTime { get; private set; }
    public bool TypedStart { get; private set; }
    public List<SlotChoice> Starts { get; } = [];
    public string? Recommendation { get; private set; }
    public List<SocialChoice> Socials { get; } = [];
    public bool SocialJoined { get; private set; }
    public bool SocialNeedsPayment { get; private set; }
    public bool SocialAlreadyJoined { get; private set; }

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
            NeedsDuration = Has(result.Response, "needsDuration");
            NeedsStartTime = Has(result.Response, "needsStartTime");
            TypedStart = Has(result.Response, "typedStart");
            Recommendation = Text(JsonSerializer.SerializeToElement(result.Response), "recommendation");
            Slots.Clear();
            Starts.Clear();
            if (NeedsStartTime)
            {
                Starts.AddRange(ReadStartChoices(result.Response));
            }
            else if (!NeedsDuration)
            {
                Slots.AddRange(ReadSlots(result.Response));
            }
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
            Socials.Clear();
            Socials.AddRange(SupportSocialSteps.Read(result.Response));
        }

        if (tool == "join_public_social" && Has(result.Response, "registrationId") && !Has(result.Response, "error"))
        {
            SocialJoined = true;
            SocialNeedsPayment = Has(result.Response, "needsPayment");
            SocialAlreadyJoined = Has(result.Response, "alreadyJoined");
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
                .Select(court =>
                {
                    var name = Text(court, "courtName");
                    var courtWindow = Text(court, "windowFormatted") ?? window;
                    var courtWhen = Text(court, "dateFormatted") ?? when;
                    return string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(courtWindow)
                        ? null
                        : SlotChoice.Create(name, courtWhen, courtWindow);
                })
                .Where(choice => choice is not null)
                .Select(choice => choice!)
                .Take(12)
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
                .Take(12)
                .ToArray();
            if (choices.Length > 0)
            {
                return choices;
            }
        }

        return [];
    }

    private static IEnumerable<SlotChoice> ReadStartChoices(object response)
    {
        var json = JsonSerializer.SerializeToElement(response);
        if (json.ValueKind != JsonValueKind.Object || !json.TryGetProperty("startChoices", out var list) || list.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return list.EnumerateArray()
            .Select(item =>
            {
                var label = Text(item, "label");
                var prompt = Text(item, "prompt");
                return string.IsNullOrWhiteSpace(label)
                    ? null
                    : new SlotChoice(label.Trim(), string.IsNullOrWhiteSpace(prompt) ? $"Start at {label.Trim()}" : prompt.Trim());
            })
            .Where(choice => choice is not null)
            .Select(choice => choice!)
            .Take(6);
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
        var lastUser = turns.LastOrDefault(turn => turn.Role == "user").Text ?? "";
        if (AsksHowPointsWork(lastUser))
        {
            return new SupportReplyPlan([], PointsExplanation());
        }

        var pickedSlot = PickedSlot(said);
        var waitingForDuration = !pickedSlot && ChosenDuration(said) is null && AskedForCourts(said);
        var socialFlow = SupportSocialSteps.InFlow(said);
        if (!progress.Booking && !pickedSlot && !waitingForDuration && !socialFlow)
        {
            return new SupportReplyPlan(StampPromo(actions, said, progress), null);
        }

        if (actions.Any(action => action.Kind == "stripe_checkout"))
        {
            var social = SupportSocialSteps.Guide(said, progress, nowLocal);
            return new SupportReplyPlan(StampPromo(actions, said, progress), social.Handled ? social.Reply : null);
        }

        var next = Next(said, progress, nowLocal);
        var kept = next.Any(action => action.Kind == "close_chat")
            ? actions.Where(action => action.Kind != "my_bookings_link" || action.Href?.Contains("/social/", StringComparison.Ordinal) == true).ToArray()
            : actions;
        if (WaitingForStart(said, progress))
        {
            kept = kept.Where(action => action.Kind != "quick_replies").ToArray();
        }
        var combined = next.Count == 0 ? kept : kept.Concat(next).ToArray();
        return new SupportReplyPlan(StampPromo(combined, said, progress, actions), GuidedReply(said, progress, nowLocal));
    }

    private static IReadOnlyList<SupportChatAction> Next(string said, SupportReplyProgress progress, DateTime? nowLocal)
    {
        var choseSchedule = Has(said, "one session") || Has(said, "1 week") || Has(said, "repeat weekly") || Has(said, "repeat this court");
        var promoSettled = Has(said, "without a promotion code or reward points")
            || Has(said, "apply the promotion code and redeem")
            || Has(said, "redeem my reward points")
            || Regex.IsMatch(said, @"\bApply promotion code\b", RegexOptions.IgnoreCase);
        var social = SupportSocialSteps.Actions(said, progress, nowLocal);
        if (social is not null)
        {
            return social;
        }

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
        if (!pickedSlot && ChosenDuration(said) is null && (progress.NeedsDuration || progress.Slots.Count > 0 || progress.Starts.Count > 0 || AskedForCourts(said)))
        {
            return DurationChips();
        }

        if (WaitingForStart(said, progress))
        {
            if (WantsTypedStart(said, nowLocal) || progress.TypedStart)
            {
                return [];
            }

            var starts = progress.Starts.Count > 0 ? progress.Starts : StartsFromSlots(OpenSlots(progress, nowLocal));
            return starts.Select(slot => Chip(slot.Label, slot.Prompt)).ToArray();
        }

        if (progress.Slots.Count > 0 && !pickedSlot)
        {
            return OpenSlots(progress, nowLocal).Select(slot => Chip(slot.Label, slot.Prompt)).ToArray();
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
        var social = SupportSocialSteps.Guide(said, progress, nowLocal);
        if (social.Handled)
        {
            return social.Reply;
        }

        if (progress.HoldSaved && Has(said, "pay later") && !Has(said, "pay from this chat"))
        {
            return "Your booking is held. Please pay later in My Bookings, pay from this chat, or finish chatting. Pay at least 24 hours before play, or the court is released.";
        }

        if (!pickedSlot)
        {
            if (ChosenDuration(said) is null && (progress.NeedsDuration || progress.Slots.Count > 0 || progress.Starts.Count > 0 || AskedForCourts(said)))
            {
                return "Please tell me how long you would like to play.";
            }

            if (WaitingForStart(said, progress))
            {
                if (WantsTypedStart(said, nowLocal) || progress.TypedStart)
                {
                    return "Please type the time you would like to start, for example 6:00 PM.";
                }

                var starts = progress.Starts.Count > 0 ? progress.Starts : StartsFromSlots(OpenSlots(progress, nowLocal));
                return starts.Count == 0
                    ? "Please choose a later time today, or look at tomorrow. Nothing is still open from now for that length."
                    : "Please choose what time you would like to start. These times begin at the earliest one still open.";
            }

            if (StartChosen(said) && progress.Slots.Count > 0)
            {
                return string.IsNullOrWhiteSpace(progress.Recommendation) ? "Please choose a court." : progress.Recommendation;
            }

            if (progress.Slots.Count == 0)
            {
                return string.IsNullOrWhiteSpace(progress.Recommendation) || progress.PayNowOnly
                    ? null
                    : progress.Recommendation;
            }

            if (progress.PayNowOnly)
            {
                return null;
            }

            var open = OpenSlots(progress, nowLocal);
            if (open.Count == 0)
            {
                return "Please choose a later time today, or look at tomorrow. Those times have already started.";
            }

            return string.IsNullOrWhiteSpace(progress.Recommendation)
                ? "Please choose one of these times."
                : progress.Recommendation;
        }

        if (progress.PayNowOnly)
        {
            return null;
        }

        if (!choseSchedule)
        {
            return StartsWithin24Hours(said, nowLocal)
                ? "Please choose one session, a hold for 1 week, or a weekly repeat. This session starts within 24 hours, so it must be paid now. An unpaid hold lasts 30 minutes."
                : "Please choose one session, a hold for 1 week, or a weekly repeat.";
        }

        if (!promoSettled)
        {
            return PromoQuestion(progress);
        }

        return null;
    }

    internal static string? SelectedPromo(string said, SupportReplyProgress progress) => ChosenPromo(said, progress);

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

    private static string? ChosenPromo(string said, SupportReplyProgress progress)
    {
        var match = Regex.Match(said, @"\bApply promotion code\s+([A-Za-z0-9]+)", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            return match.Groups[1].Value.ToUpperInvariant();
        }

        if (Has(said, "apply the promotion code and redeem"))
        {
            return progress.PromoCode?.ToUpperInvariant();
        }

        return null;
    }

    private static SupportChatAction[] StampPromo(IReadOnlyList<SupportChatAction> actions, string said, SupportReplyProgress progress, IReadOnlyList<SupportChatAction>? links = null)
    {
        var code = ChosenPromo(said, progress);
        var groupHref = (links ?? actions).Select(action => action.Href).FirstOrDefault(href => href?.Contains("/book/group/", StringComparison.Ordinal) == true);
        return actions
            .Select(action => action.Href == "/profile/bookings" && groupHref is not null ? action with { Href = groupHref } : action)
            .Select(action => WithPromo(action, code))
            .Select(action => WithPoints(action, WantsAllPoints(said)))
            .ToArray();
    }

    internal static bool WantsAllPoints(string said)
    {
        var redeem = Math.Max(said.LastIndexOf("redeem my reward points", StringComparison.OrdinalIgnoreCase), said.LastIndexOf("apply the promotion code and redeem", StringComparison.OrdinalIgnoreCase));
        var decline = said.LastIndexOf("without a promotion code or reward points", StringComparison.OrdinalIgnoreCase);
        return redeem >= 0 && redeem > decline;
    }

    private static SupportChatAction WithPromo(SupportChatAction action, string? code)
    {
        if (string.IsNullOrWhiteSpace(code) || action.Kind != "my_bookings_link" || string.IsNullOrWhiteSpace(action.Href) || action.Href.Contains("promo=", StringComparison.OrdinalIgnoreCase))
        {
            return action;
        }

        var join = action.Href.Contains('?', StringComparison.Ordinal) ? "&" : "?";
        return action with { Href = $"{action.Href}{join}promo={Uri.EscapeDataString(code)}", PromoCode = code };
    }

    private static SupportChatAction WithPoints(SupportChatAction action, bool allPoints)
    {
        if (!allPoints || action.Kind != "my_bookings_link" || string.IsNullOrWhiteSpace(action.Href) || action.Href.Contains("points=", StringComparison.OrdinalIgnoreCase))
        {
            return action;
        }

        var join = action.Href.Contains('?', StringComparison.Ordinal) ? "&" : "?";
        return action with { Href = $"{action.Href}{join}points=100" };
    }

    private static int? ChosenDuration(string said)
    {
        if (Has(said, "3 hours")) return 180;
        if (Has(said, "2 hours 30") || Has(said, "2 hour 30")) return 150;
        if (Has(said, "2 hours")) return 120;
        if (Has(said, "1 hour 30") || Has(said, "90 minutes")) return 90;
        if (Has(said, "1 hour") || Has(said, "60 minutes")) return 60;
        if (Has(said, "30 minutes")) return 30;
        return null;
    }

    private static bool AsksHowPointsWork(string said) =>
        Has(said, "pending to available");

    private static string PointsExplanation() =>
        "Available points are ready to spend on the pay page. Pending points are set aside when you book a court, join a public social, or add friends, and an incentive is on for that date. They are not ready to spend yet. After that session ends, they join your available balance. A cancelled place, a waitlist place that never opens, or a payment that does not finish does not earn the incentive. A promotion code is applied first, and points come off what is left.";

    private static bool AskedForCourts(string said) =>
        Has(said, "free today") || Has(said, "free tomorrow") || Has(said, "free on") || Has(said, "courts are free") || Has(said, "what is free") || Has(said, "book a court") || Has(said, "which courts");

    private static bool StartChosen(string said) => SupportDiscoveryShared.StartChosenByPlayer(said) is not null;

    private static bool WaitingForStart(string said, SupportReplyProgress progress) =>
        !PickedSlot(said)
        && ChosenDuration(said) is not null
        && !StartChosen(said)
        && (progress.NeedsStartTime || progress.TypedStart || progress.Starts.Count > 0 || progress.Slots.Count > 0 || AskedForCourts(said));

    private static bool WantsTypedStart(string said, DateTime? nowLocal)
    {
        var today = DateOnly.FromDateTime(nowLocal ?? DateTime.UtcNow);
        var chosen = SupportDiscoveryShared.DateChosenByPlayer(said, today);
        return chosen is not null && chosen.Value > today;
    }

    private static IReadOnlyList<SlotChoice> StartsFromSlots(IReadOnlyList<SlotChoice> slots) =>
        slots
            .Select(slot => Regex.Match(slot.Label, @"(\d{1,2}:\d{2}\s*[AP]M)", RegexOptions.IgnoreCase))
            .Where(match => match.Success)
            .Select(match => match.Groups[1].Value.ToUpperInvariant())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(label => new SlotChoice(label, $"Start at {label}"))
            .Take(6)
            .ToArray();

    private static SupportChatAction[] DurationChips() =>
    [
        Chip("30 minutes", "Book for 30 minutes"),
        Chip("1 hour", "Book for 1 hour"),
        Chip("1 hour 30 minutes", "Book for 1 hour 30 minutes"),
        Chip("2 hours", "Book for 2 hours"),
        Chip("2 hours 30 minutes", "Book for 2 hours 30 minutes"),
        Chip("3 hours", "Book for 3 hours"),
    ];

    private static bool PickedSlot(string said) =>
        Regex.IsMatch(said, @"\bSelect\b.+\d{1,2}:\d{2}", RegexOptions.IgnoreCase);

    private static IReadOnlyList<SlotChoice> OpenSlots(SupportReplyProgress progress, DateTime? nowLocal) =>
        progress.Slots.Where(slot => SlotIsAhead(slot, nowLocal)).Take(6).ToArray();

    private static bool SlotIsAhead(SlotChoice slot, DateTime? nowLocal)
    {
        if (nowLocal is null)
        {
            return true;
        }

        var match = Regex.Match(
            slot.Prompt,
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

        return start > nowLocal.Value.AddMinutes(5);
    }

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
