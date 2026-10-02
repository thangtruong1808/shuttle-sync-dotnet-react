using ShuttleSync.Api.Data;
using Stripe;
using Stripe.Checkout;

namespace ShuttleSync.Api.Booking;

public sealed class BookingPayments(
    StripeSettings settings,
    PaymentRepository payments,
    DashboardRepository dashboard)
{
    public async Task<CheckoutResponse> CheckoutAsync(
        Guid venueId,
        Guid sessionId,
        Guid userId,
        int points,
        string? promotionCode,
        string successUrl,
        string cancelUrl,
        CancellationToken cancellationToken)
    {
        if (settings.IsConfigured)
        {
            StripeConfiguration.ApiKey = settings.SecretKey;
        }

        await CancelIntentsAsync(await payments.ReleaseExpiredHoldsAsync(cancellationToken), cancellationToken);
        var prepared = await payments.PrepareCheckoutAsync(venueId, sessionId, userId, points, promotionCode, cancellationToken);
        if (prepared.Error is not null)
        {
            return CheckoutResponse.Fail(prepared.Error, prepared.StatusCode);
        }

        if (prepared.NeedsPayment && !settings.IsConfigured)
        {
            await payments.RollbackPendingAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail("Card payments are not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        if (!prepared.NeedsPayment)
        {
            await SnapshotAsync(venueId, sessionId, userId, cancellationToken);
            return CheckoutResponse.From(prepared, null);
        }

        var replacePayment = false;
        if (!string.IsNullOrWhiteSpace(prepared.ExistingIntentId))
        {
            if (prepared.ExistingIntentId.StartsWith("cs_", StringComparison.Ordinal))
            {
                var resumed = await ResumeCheckoutSessionAsync(prepared, userId, cancellationToken);
                if (resumed is not null)
                {
                    return resumed;
                }

                replacePayment = true;
            }
            else
            {
                var existing = await new PaymentIntentService().GetAsync(prepared.ExistingIntentId, cancellationToken: cancellationToken);
                await ApplyIntentAsync(existing, cancellationToken);
                var current = await payments.FindOwnedPaymentAsync(userId, prepared.BookingId, cancellationToken);
                if (current is { Status: "confirmed" })
                {
                    return CheckoutResponse.From(prepared, null) with { Status = "confirmed" };
                }

                if (current is { Status: "expired" })
                {
                    return CheckoutResponse.Fail("The payment failed and the slot was released. Start the booking again.", StatusCodes.Status409Conflict);
                }

                if (existing.Status == "processing")
                {
                    return CheckoutResponse.From(prepared, null);
                }

                await CancelIntentsAsync([prepared.ExistingIntentId], cancellationToken);
                await payments.CancelPendingPaymentRowAsync(prepared.BookingId, cancellationToken);
                replacePayment = true;
            }
        }

        var customerId = await CustomerIdAsync(prepared.StripeCustomerId, prepared.Email, userId, cancellationToken);
        Session session;
        try
        {
            session = await CreateCheckoutSessionAsync(prepared, customerId, successUrl, cancelUrl, includePayTo: true, replacePayment, cancellationToken);
        }
        catch (StripeException exception) when (MentionsPayTo(exception))
        {
            try
            {
                session = await CreateCheckoutSessionAsync(prepared, customerId, successUrl, cancelUrl, includePayTo: false, replacePayment, cancellationToken);
            }
            catch (StripeException retry)
            {
                await payments.RollbackPendingAsync(prepared.BookingId, cancellationToken);
                return CheckoutResponse.Fail(retry.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
            }
        }
        catch (StripeException exception)
        {
            await payments.RollbackPendingAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail(exception.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        if (string.IsNullOrWhiteSpace(session.Url))
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await payments.RollbackPendingAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail("The payment page could not be opened.", StatusCodes.Status502BadGateway);
        }

        try
        {
            await payments.AttachPaymentAsync(prepared.BookingId, userId, customerId, session.Id, prepared.Cash, prepared.Currency, cancellationToken);
        }
        catch
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await payments.RollbackPendingAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail("The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        return CheckoutResponse.From(prepared, session.Url);
    }

    public async Task SyncAsync(Guid userId, Guid bookingId, CancellationToken cancellationToken)
    {
        if (!settings.IsConfigured)
        {
            return;
        }

        var row = await payments.FindOwnedPaymentAsync(userId, bookingId, cancellationToken);
        if (row is not { Status: "pending" } || string.IsNullOrWhiteSpace(row.StripePaymentIntentId))
        {
            return;
        }

        StripeConfiguration.ApiKey = settings.SecretKey;
        var intentId = row.StripePaymentIntentId;
        if (intentId.StartsWith("cs_", StringComparison.Ordinal))
        {
            var checkout = await new SessionService().GetAsync(intentId, cancellationToken: cancellationToken);
            if (string.IsNullOrWhiteSpace(checkout.PaymentIntentId))
            {
                return;
            }

            if (!await payments.BindPaymentIntentAsync(bookingId, checkout.PaymentIntentId, cancellationToken))
            {
                return;
            }

            intentId = checkout.PaymentIntentId;
        }

        var intent = await new PaymentIntentService().GetAsync(intentId, cancellationToken: cancellationToken);
        await ApplyIntentAsync(intent, cancellationToken);
    }

    public async Task<CancelResponse> CancelAsync(Guid userId, Guid bookingId, CancellationToken cancellationToken)
    {
        var context = await payments.LoadCancelAsync(userId, bookingId, cancellationToken);
        if (context is null)
        {
            return CancelResponse.Fail("That booking was not found.", StatusCodes.Status404NotFound);
        }

        if (context.Status is not ("pending" or "confirmed") || context.StartTime <= DateTime.UtcNow)
        {
            return CancelResponse.Fail("This booking can no longer be cancelled.", StatusCodes.Status409Conflict);
        }

        var late = DateTime.SpecifyKind(context.StartTime, DateTimeKind.Utc) <= DateTime.UtcNow.AddHours(24);
        var fee = context.PaymentStatus == "succeeded" && late ? context.LateCancelFeePercent : 0m;
        string? refundId = null;
        var refundStatus = "succeeded";
        decimal refundAmount = 0m;
        if (context.PaymentStatus == "succeeded"
            && context.PaymentAmount > 0
            && !string.IsNullOrWhiteSpace(context.StripePaymentIntentId))
        {
            refundAmount = decimal.Round(context.PaymentAmount * (100m - fee) / 100m, 2, MidpointRounding.AwayFromZero);
            if (refundAmount > context.PaymentAmount)
            {
                refundAmount = context.PaymentAmount;
            }

            if (refundAmount > 0)
            {
                if (!settings.IsConfigured)
                {
                    return CancelResponse.Fail("Card payments are not configured yet.", StatusCodes.Status503ServiceUnavailable);
                }

                StripeConfiguration.ApiKey = settings.SecretKey;
                try
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions
                        {
                            PaymentIntent = context.StripePaymentIntentId,
                            Amount = Cents(refundAmount),
                        },
                        new RequestOptions { IdempotencyKey = "refund-" + bookingId.ToString("N") },
                        cancellationToken);
                    refundId = refund.Id;
                    refundStatus = MapRefundStatus(refund.Status);
                }
                catch (StripeException exception)
                {
                    return CancelResponse.Fail(exception.StripeError?.Message ?? "The refund could not be started.", StatusCodes.Status502BadGateway);
                }
            }
        }
        else if (context.PaymentStatus == "pending" && !string.IsNullOrWhiteSpace(context.StripePaymentIntentId))
        {
            if (settings.IsConfigured)
            {
                StripeConfiguration.ApiKey = settings.SecretKey;
                await CancelIntentsAsync([context.StripePaymentIntentId], cancellationToken);
            }
        }

        var target = fee == 0
            ? context.PointsRedeemed
            : (int)Math.Floor(context.PointsRedeemed * (100m - fee) / 100m);
        var restore = Math.Max(0, target - context.PointsRestored);
        string? paymentStatus = context.PaymentStatus switch
        {
            "succeeded" when refundAmount <= 0 => null,
            "succeeded" when refundAmount >= context.PaymentAmount => "refunded",
            "succeeded" => "partially_refunded",
            "pending" => "cancelled",
            _ => null,
        };
        var saved = await payments.CompleteCancelAsync(
            new CancelWrite(context.Id, userId, fee, restore, context.PaymentId, paymentStatus, refundId, refundAmount, refundStatus),
            cancellationToken);
        if (!saved)
        {
            return CancelResponse.Fail("This booking can no longer be cancelled.", StatusCodes.Status409Conflict);
        }

        return new CancelResponse(StatusCodes.Status200OK, null, refundAmount, fee, restore, context.Currency);
    }

    public async Task<IResult> WebhookAsync(HttpContext http, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(settings.WebhookSecret))
        {
            return Results.BadRequest();
        }

        var json = await new StreamReader(http.Request.Body).ReadToEndAsync(cancellationToken);
        var signature = http.Request.Headers["Stripe-Signature"].ToString();
        Event stripeEvent;
        try
        {
            stripeEvent = EventUtility.ConstructEvent(json, signature, settings.WebhookSecret, throwOnApiVersionMismatch: false);
        }
        catch (StripeException)
        {
            return Results.BadRequest();
        }

        StripeConfiguration.ApiKey = settings.SecretKey;
        var intent = stripeEvent.Data.Object as PaymentIntent;
        var recorded = await payments.TryRecordWebhookAsync(stripeEvent.Id, stripeEvent.Type, intent?.Id, json, cancellationToken);
        if (!recorded)
        {
            return Results.Ok();
        }

        try
        {
            if (stripeEvent.Data.Object is Session checkoutSession)
            {
                if (!await ApplyCheckoutSessionAsync(stripeEvent.Type, checkoutSession, cancellationToken))
                {
                    await payments.FinishWebhookAsync(stripeEvent.Id, "failed", "Payment was not recorded yet.", cancellationToken);
                    return Results.StatusCode(StatusCodes.Status500InternalServerError);
                }
            }
            else if (intent is not null)
            {
                var waitingForRow = stripeEvent.Type is "payment_intent.succeeded" or "payment_intent.processing" or "payment_intent.payment_failed" or "payment_intent.canceled";
                if (waitingForRow && !await EnsurePaymentLinkedAsync(intent, cancellationToken))
                {
                    await payments.FinishWebhookAsync(stripeEvent.Id, "failed", "Payment was not recorded yet.", cancellationToken);
                    return Results.StatusCode(StatusCodes.Status500InternalServerError);
                }

                if (stripeEvent.Type == "payment_intent.payment_failed")
                {
                    var failed = await payments.FailPendingAsync(
                        intent.Id,
                        "failed",
                        intent.LastPaymentError?.Code,
                        intent.LastPaymentError?.Message,
                        cancellationToken);
                    if (failed)
                    {
                        await CancelIntentsAsync([intent.Id], cancellationToken);
                    }
                }
                else
                {
                    await ApplyIntentAsync(intent, cancellationToken);
                }
            }

            await payments.FinishWebhookAsync(stripeEvent.Id, "processed", null, cancellationToken);
            return Results.Ok();
        }
        catch (Exception exception)
        {
            var message = exception.Message.Length <= 500 ? exception.Message : exception.Message[..500];
            await payments.FinishWebhookAsync(stripeEvent.Id, "failed", message, cancellationToken);
            return Results.StatusCode(StatusCodes.Status500InternalServerError);
        }
    }

    private async Task ApplyIntentAsync(PaymentIntent intent, CancellationToken cancellationToken)
    {
        switch (intent.Status)
        {
            case "succeeded":
                var transition = await payments.MarkSucceededAsync(intent.Id, intent.LatestChargeId, cancellationToken);
                if (transition is null)
                {
                    return;
                }

                if (transition.Action is "confirmed" or "already")
                {
                    await SnapshotAsync(transition.VenueId, transition.SessionId, transition.UserId, cancellationToken);
                    return;
                }

                if (transition.Action == "refund" && transition.PaymentStatus is not ("refunded" or "partially_refunded") && transition.Amount > 0)
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions { PaymentIntent = intent.Id, Amount = Cents(transition.Amount) },
                        new RequestOptions { IdempotencyKey = "refund-late-" + transition.BookingId.ToString("N") },
                        cancellationToken);
                    await payments.RecordRefundAsync(intent.Id, refund.Id, transition.Amount, MapRefundStatus(refund.Status), cancellationToken);
                }

                return;
            case "processing":
                var type = await MethodTypeAsync(intent, cancellationToken);
                var until = type switch
                {
                    "au_becs_debit" => DateTime.UtcNow.AddDays(5),
                    "payto" => DateTime.UtcNow.AddMinutes(60),
                    _ => (DateTime?)null,
                };
                if (until is not null)
                {
                    await payments.ExtendHoldAsync(intent.Id, until.Value, cancellationToken);
                }

                return;
            case "canceled":
                await payments.FailPendingAsync(intent.Id, "cancelled", "canceled", "The payment was cancelled.", cancellationToken);
                return;
        }
    }

    private async Task SnapshotAsync(Guid venueId, Guid sessionId, Guid userId, CancellationToken cancellationToken)
    {
        try
        {
            await dashboard.SnapshotBookingIncentiveAsync(venueId, sessionId, userId, cancellationToken);
        }
        catch (Exception)
        {
            // The booking is already confirmed. A later incentive save can fill the snapshot.
        }
    }

    private static async Task<string?> MethodTypeAsync(PaymentIntent intent, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(intent.PaymentMethod?.Type))
        {
            return intent.PaymentMethod.Type;
        }

        if (string.IsNullOrWhiteSpace(intent.PaymentMethodId))
        {
            return null;
        }

        var fresh = await new PaymentIntentService().GetAsync(
            intent.Id,
            new PaymentIntentGetOptions { Expand = ["payment_method"] },
            cancellationToken: cancellationToken);
        return fresh.PaymentMethod?.Type;
    }

    private static async Task<string> CustomerIdAsync(string? existing, string email, Guid userId, CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(existing))
        {
            return existing;
        }

        var customer = await new CustomerService().CreateAsync(
            new CustomerCreateOptions
            {
                Email = email,
                Metadata = new Dictionary<string, string> { ["userId"] = userId.ToString() },
            },
            new RequestOptions { IdempotencyKey = "customer-" + userId.ToString("N") },
            cancellationToken);
        return customer.Id;
    }

    private static async Task<Session> CreateCheckoutSessionAsync(
        CheckoutPrepared prepared,
        string customerId,
        string successUrl,
        string cancelUrl,
        bool includePayTo,
        bool replacement,
        CancellationToken cancellationToken)
    {
        var types = new List<string> { "card", "au_becs_debit" };
        if (includePayTo)
        {
            types.Add("payto");
        }

        var key = "checkout-" + prepared.BookingId.ToString("N");
        if (!includePayTo)
        {
            key += "-card";
        }

        if (replacement)
        {
            key += "-" + Guid.NewGuid().ToString("N");
        }

        return await new SessionService().CreateAsync(
            new SessionCreateOptions
            {
                Mode = "payment",
                Customer = customerId,
                SuccessUrl = successUrl,
                CancelUrl = cancelUrl,
                PaymentMethodTypes = types,
                ClientReferenceId = prepared.BookingId.ToString(),
                Metadata = new Dictionary<string, string> { ["bookingId"] = prepared.BookingId.ToString() },
                PaymentIntentData = new SessionPaymentIntentDataOptions
                {
                    ReceiptEmail = string.IsNullOrWhiteSpace(prepared.Email) ? null : prepared.Email,
                    Metadata = new Dictionary<string, string> { ["bookingId"] = prepared.BookingId.ToString() },
                },
                LineItems =
                [
                    new SessionLineItemOptions
                    {
                        Quantity = 1,
                        PriceData = new SessionLineItemPriceDataOptions
                        {
                            Currency = prepared.Currency.ToLowerInvariant(),
                            UnitAmount = Cents(prepared.Cash),
                            ProductData = new SessionLineItemPriceDataProductDataOptions { Name = "Court booking" },
                        },
                    },
                ],
            },
            new RequestOptions { IdempotencyKey = key },
            cancellationToken);
    }

    private async Task<CheckoutResponse?> ResumeCheckoutSessionAsync(
        CheckoutPrepared prepared,
        Guid userId,
        CancellationToken cancellationToken)
    {
        Session existing;
        try
        {
            existing = await new SessionService().GetAsync(prepared.ExistingIntentId!, cancellationToken: cancellationToken);
        }
        catch (StripeException)
        {
            await payments.CancelPendingPaymentRowAsync(prepared.BookingId, cancellationToken);
            return null;
        }

        if (!string.IsNullOrWhiteSpace(existing.PaymentIntentId))
        {
            await payments.BindPaymentIntentAsync(prepared.BookingId, existing.PaymentIntentId, cancellationToken);
            var intent = await new PaymentIntentService().GetAsync(existing.PaymentIntentId, cancellationToken: cancellationToken);
            await ApplyIntentAsync(intent, cancellationToken);
            var current = await payments.FindOwnedPaymentAsync(userId, prepared.BookingId, cancellationToken);
            if (current is { Status: "confirmed" })
            {
                return CheckoutResponse.From(prepared, null) with { Status = "confirmed" };
            }

            if (current is { Status: "expired" })
            {
                return CheckoutResponse.Fail("The payment failed and the slot was released. Start the booking again.", StatusCodes.Status409Conflict);
            }

            if (intent.Status == "processing")
            {
                return CheckoutResponse.From(prepared, null);
            }
        }

        if (existing.Status == "open" && !string.IsNullOrWhiteSpace(existing.Url))
        {
            return CheckoutResponse.From(prepared, existing.Url);
        }

        await CancelIntentsAsync([existing.Id], cancellationToken);
        await payments.CancelPendingPaymentRowAsync(prepared.BookingId, cancellationToken);
        return null;
    }

    private async Task<bool> ApplyCheckoutSessionAsync(string eventType, Session session, CancellationToken cancellationToken)
    {
        if (eventType == "checkout.session.expired")
        {
            await payments.FailPendingAsync(session.Id, "cancelled", "expired", "The payment page expired.", cancellationToken);
            return true;
        }

        if (eventType is not ("checkout.session.completed" or "checkout.session.async_payment_succeeded" or "checkout.session.async_payment_failed"))
        {
            return true;
        }

        if (string.IsNullOrWhiteSpace(session.PaymentIntentId))
        {
            return false;
        }

        var bookingRaw = session.ClientReferenceId;
        if (string.IsNullOrWhiteSpace(bookingRaw) && session.Metadata is not null)
        {
            session.Metadata.TryGetValue("bookingId", out bookingRaw);
        }

        if (!Guid.TryParse(bookingRaw, out var bookingId)
            || !await payments.BindPaymentIntentAsync(bookingId, session.PaymentIntentId, cancellationToken))
        {
            return false;
        }

        var intent = await new PaymentIntentService().GetAsync(session.PaymentIntentId, cancellationToken: cancellationToken);
        if (eventType == "checkout.session.async_payment_failed")
        {
            await payments.FailPendingAsync(intent.Id, "failed", intent.LastPaymentError?.Code, intent.LastPaymentError?.Message, cancellationToken);
            return true;
        }

        await ApplyIntentAsync(intent, cancellationToken);
        return true;
    }

    private async Task<bool> EnsurePaymentLinkedAsync(PaymentIntent intent, CancellationToken cancellationToken)
    {
        if (await payments.PaymentExistsAsync(intent.Id, cancellationToken))
        {
            return true;
        }

        if (intent.Metadata is not null
            && intent.Metadata.TryGetValue("bookingId", out var bookingRaw)
            && Guid.TryParse(bookingRaw, out var bookingId))
        {
            return await payments.BindPaymentIntentAsync(bookingId, intent.Id, cancellationToken);
        }

        return false;
    }

    private static async Task CancelIntentsAsync(IReadOnlyList<string> intentIds, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(StripeConfiguration.ApiKey))
        {
            return;
        }

        var service = new PaymentIntentService();
        var sessions = new SessionService();
        foreach (var intentId in intentIds)
        {
            try
            {
                if (intentId.StartsWith("cs_", StringComparison.Ordinal))
                {
                    await sessions.ExpireAsync(intentId, cancellationToken: cancellationToken);
                }
                else
                {
                    await service.CancelAsync(intentId, cancellationToken: cancellationToken);
                }
            }
            catch (StripeException)
            {
                // The payment may already be finished or expired.
            }
        }
    }

    private static bool MentionsPayTo(StripeException exception)
    {
        var message = exception.StripeError?.Message ?? exception.Message;
        return message.Contains("payto", StringComparison.OrdinalIgnoreCase);
    }

    private static string MapRefundStatus(string? status) => status switch
    {
        "succeeded" => "succeeded",
        "failed" => "failed",
        "canceled" => "cancelled",
        _ => "pending",
    };

    private static long Cents(decimal amount) =>
        (long)decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero);
}

public sealed record CheckoutResponse(
    int StatusCode,
    string? Error,
    Guid BookingId,
    string Status,
    string? CheckoutUrl,
    string Currency,
    decimal Subtotal,
    decimal DiscountAmount,
    int PointsRedeemed,
    decimal PointsValue,
    decimal CashAmount)
{
    public static CheckoutResponse Fail(string error, int statusCode) =>
        new(statusCode, error, Guid.Empty, "", null, "AUD", 0, 0, 0, 0, 0);

    public static CheckoutResponse From(CheckoutPrepared prepared, string? checkoutUrl) =>
        new(StatusCodes.Status200OK, null, prepared.BookingId, prepared.Status, checkoutUrl, prepared.Currency, prepared.Subtotal, prepared.Discount, prepared.Points, prepared.PointsValue, prepared.Cash);
}

public sealed record CancelResponse(
    int StatusCode,
    string? Error,
    decimal RefundAmount,
    decimal FeePercent,
    int PointsRestored,
    string Currency)
{
    public static CancelResponse Fail(string error, int statusCode) =>
        new(statusCode, error, 0, 0, 0, "AUD");
}
