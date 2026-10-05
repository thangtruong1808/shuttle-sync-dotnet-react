using ShuttleSync.Api.Data;
using Stripe;
using Stripe.Checkout;

namespace ShuttleSync.Api.Booking;

public sealed class BookingPayments(
    StripeSettings settings,
    PaymentRepository payments,
    DashboardRepository dashboard,
    BookingRepository bookings)
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

    public async Task ReleaseExpiredCourtHoldsAsync(CancellationToken cancellationToken)
    {
        await CancelIntentsAsync(await payments.ReleaseExpiredHoldsAsync(cancellationToken), cancellationToken);
        try
        {
            foreach (var added in await bookings.ExtendRepeatHoldsAsync(cancellationToken))
            {
                await SnapshotAsync(added.VenueId, added.SessionId, added.UserId, cancellationToken);
            }
        }
        catch (Exception)
        {
            // A repeat hold can be tried again the next time bookings are loaded.
        }
    }

    public async Task<CheckoutResponse> CheckoutGroupAsync(
        Guid venueId,
        Guid groupId,
        Guid userId,
        IReadOnlyList<Guid> bookingIds,
        int points,
        string? promotionCode,
        string successUrl,
        string cancelUrl,
        CancellationToken cancellationToken,
        bool releaseFirst = true)
    {
        if (settings.IsConfigured)
        {
            StripeConfiguration.ApiKey = settings.SecretKey;
        }

        if (releaseFirst)
        {
            await ReleaseExpiredCourtHoldsAsync(cancellationToken);
        }

        var prepared = await payments.PrepareGroupCheckoutAsync(venueId, groupId, userId, bookingIds, points, promotionCode, cancellationToken);
        if (prepared.Error is not null)
        {
            return CheckoutResponse.Fail(prepared.Error, prepared.StatusCode);
        }

        if (prepared.NeedsPayment && !settings.IsConfigured)
        {
            await payments.UnwindGroupCheckoutAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail("Card payments are not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        if (!prepared.NeedsPayment)
        {
            foreach (var sessionId in prepared.SessionIds.Distinct())
            {
                await SnapshotAsync(venueId, sessionId, userId, cancellationToken);
            }

            return CheckoutResponse.From(prepared, null);
        }

        if (!string.IsNullOrWhiteSpace(prepared.ExistingIntentId))
        {
            await CancelIntentsAsync([prepared.ExistingIntentId], cancellationToken);
        }

        var customerId = await CustomerIdAsync(prepared.StripeCustomerId, prepared.Email, userId, cancellationToken);
        Session session;
        try
        {
            session = await CreateCheckoutSessionAsync(prepared, customerId, successUrl, cancelUrl, includePayTo: true, prepared.ReplacePayment, cancellationToken);
        }
        catch (StripeException exception) when (MentionsPayTo(exception))
        {
            try
            {
                session = await CreateCheckoutSessionAsync(prepared, customerId, successUrl, cancelUrl, includePayTo: false, true, cancellationToken);
            }
            catch (StripeException retry)
            {
                await payments.UnwindGroupCheckoutAsync(prepared.BookingId, cancellationToken);
                return CheckoutResponse.Fail(retry.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
            }
        }
        catch (StripeException exception)
        {
            await payments.UnwindGroupCheckoutAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail(exception.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        if (string.IsNullOrWhiteSpace(session.Url))
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await payments.UnwindGroupCheckoutAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail("The payment page could not be opened.", StatusCodes.Status502BadGateway);
        }

        try
        {
            await payments.AttachPaymentAsync(prepared.BookingId, userId, customerId, session.Id, prepared.Cash, prepared.Currency, cancellationToken);
        }
        catch
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await payments.UnwindGroupCheckoutAsync(prepared.BookingId, cancellationToken);
            return CheckoutResponse.Fail("The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        return CheckoutResponse.From(prepared, session.Url);
    }

    public async Task SyncSocialAsync(Guid userId, Guid registrationId, CancellationToken cancellationToken)
    {
        if (!settings.IsConfigured)
        {
            return;
        }

        var row = await bookings.FindOwnedSocialAsync(userId, registrationId, cancellationToken);
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

            if (!await bookings.BindSocialPaymentIntentAsync(registrationId, checkout.PaymentIntentId, cancellationToken))
            {
                return;
            }

            intentId = checkout.PaymentIntentId;
        }

        var intent = await new PaymentIntentService().GetAsync(intentId, cancellationToken: cancellationToken);
        await ApplySocialIntentAsync(intent, cancellationToken);
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
        var share = context.ShareAmount > 0 ? context.ShareAmount : context.PaymentAmount;
        if (context.PaymentStatus == "succeeded"
            && share > 0
            && !string.IsNullOrWhiteSpace(context.StripePaymentIntentId))
        {
            refundAmount = decimal.Round(share * (100m - fee) / 100m, 2, MidpointRounding.AwayFromZero);
            if (refundAmount > share)
            {
                refundAmount = share;
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
                if (IsFriend(intent.Metadata))
                {
                    await ApplyFriendIntentAsync(intent, cancellationToken);
                    await payments.FinishWebhookAsync(stripeEvent.Id, "processed", null, cancellationToken);
                    return Results.Ok();
                }

                if (IsWaitlist(intent.Metadata))
                {
                    await ApplyWaitlistIntentAsync(intent, cancellationToken);
                    await payments.FinishWebhookAsync(stripeEvent.Id, "processed", null, cancellationToken);
                    return Results.Ok();
                }

                if (IsSocial(intent.Metadata))
                {
                    await ApplySocialIntentAsync(intent, cancellationToken);
                    await payments.FinishWebhookAsync(stripeEvent.Id, "processed", null, cancellationToken);
                    return Results.Ok();
                }

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
                    var sessions = transition.SessionIds.Length > 0 ? transition.SessionIds : [transition.SessionId];
                    foreach (var sessionId in sessions.Distinct())
                    {
                        await SnapshotAsync(transition.VenueId, sessionId, transition.UserId, cancellationToken);
                    }

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
                            ProductData = new SessionLineItemPriceDataProductDataOptions { Name = string.IsNullOrWhiteSpace(prepared.ProductName) ? "Court booking" : prepared.ProductName },
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
        if (IsFriend(session.Metadata) || await bookings.FriendPaymentExistsAsync(session.Id, cancellationToken))
        {
            return await ApplyFriendCheckoutAsync(eventType, session, cancellationToken);
        }

        if (IsWaitlist(session.Metadata))
        {
            return await ApplyWaitlistCheckoutAsync(eventType, session, cancellationToken);
        }

        if (IsSocial(session.Metadata) || await bookings.SocialPaymentExistsAsync(session.Id, cancellationToken))
        {
            return await ApplySocialCheckoutAsync(eventType, session, cancellationToken);
        }

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

    public async Task<SocialCheckoutResponse> SocialCheckoutAsync(
        Guid venueId,
        Guid socialId,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        string successUrl,
        string cancelUrl,
        CancellationToken cancellationToken,
        bool waitlist = false)
    {
        if (settings.IsConfigured)
        {
            StripeConfiguration.ApiKey = settings.SecretKey;
        }

        await bookings.ExpirePublicSocialHoldsAsync(cancellationToken);
        var hold = waitlist
            ? await bookings.BeginSocialWaitlistCheckoutAsync(venueId, socialId, userId, currency, requestedPoints, promotionCode, cancellationToken)
            : await bookings.BeginPublicSocialCheckoutAsync(venueId, socialId, userId, currency, requestedPoints, promotionCode, cancellationToken);
        if (hold.Error is not null)
        {
            return SocialCheckoutResponse.Fail(hold.Error, hold.StatusCode);
        }

        if (hold.AlreadyJoined || !hold.NeedsPayment)
        {
            return SocialCheckoutResponse.From(hold, null);
        }

        if (hold.Amount > 0 && !settings.IsConfigured)
        {
            await bookings.ReleaseSocialHoldAsync(hold.RegistrationId, cancellationToken);
            return SocialCheckoutResponse.Fail("Card payments are not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        var replacePayment = hold.Requoted;
        if (hold.Requoted && !string.IsNullOrWhiteSpace(hold.ExistingIntentId))
        {
            await bookings.CancelSocialPaymentAsync(hold.ExistingIntentId, cancellationToken);
            await CancelIntentsAsync([hold.ExistingIntentId], cancellationToken);
        }

        if (!hold.Requoted && !string.IsNullOrWhiteSpace(hold.ExistingIntentId))
        {
            var resumed = await ResumeSocialCheckoutAsync(hold, userId, cancellationToken);
            if (resumed is not null)
            {
                return resumed;
            }

            replacePayment = true;
        }

        var customerId = await CustomerIdAsync(hold.StripeCustomerId, hold.Email, userId, cancellationToken);
        Session session;
        try
        {
            session = await CreateSocialSessionAsync(hold, customerId, successUrl, cancelUrl, includePayTo: true, replacePayment, cancellationToken);
        }
        catch (StripeException exception) when (MentionsPayTo(exception))
        {
            try
            {
                session = await CreateSocialSessionAsync(hold, customerId, successUrl, cancelUrl, includePayTo: false, replacePayment, cancellationToken);
            }
            catch (StripeException retry)
            {
                await bookings.ReleaseSocialHoldAsync(hold.RegistrationId, cancellationToken);
                return SocialCheckoutResponse.Fail(retry.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
            }
        }
        catch (StripeException exception)
        {
            await bookings.ReleaseSocialHoldAsync(hold.RegistrationId, cancellationToken);
            return SocialCheckoutResponse.Fail(exception.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        if (string.IsNullOrWhiteSpace(session.Url))
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await bookings.ReleaseSocialHoldAsync(hold.RegistrationId, cancellationToken);
            return SocialCheckoutResponse.Fail("The payment page could not be opened.", StatusCodes.Status502BadGateway);
        }

        try
        {
            await bookings.AttachSocialPaymentAsync(hold.RegistrationId, userId, customerId, session.Id, hold.Amount, hold.Currency, cancellationToken);
        }
        catch
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await bookings.ReleaseSocialHoldAsync(hold.RegistrationId, cancellationToken);
            return SocialCheckoutResponse.Fail("The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        return SocialCheckoutResponse.From(hold, session.Url);
    }

    public async Task<SocialCheckoutResponse> SocialBatchCheckoutAsync(
        Guid venueId,
        IReadOnlyCollection<Guid> socialIds,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        string successUrl,
        string cancelUrl,
        CancellationToken cancellationToken)
    {
        if (settings.IsConfigured)
        {
            StripeConfiguration.ApiKey = settings.SecretKey;
        }

        await bookings.ExpirePublicSocialHoldsAsync(cancellationToken);
        var hold = await bookings.BeginPublicSocialBatchCheckoutAsync(venueId, socialIds, userId, currency, requestedPoints, promotionCode, cancellationToken);
        if (hold.Error is not null)
        {
            return SocialCheckoutResponse.Fail(hold.Error, hold.StatusCode);
        }

        if (!hold.NeedsPayment || hold.CheckoutGroupId is null)
        {
            return SocialCheckoutResponse.From(hold, null);
        }

        if (hold.Amount > 0 && !settings.IsConfigured)
        {
            await bookings.ReleaseSocialGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail("Card payments are not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        if (!string.IsNullOrWhiteSpace(hold.ExistingIntentId))
        {
            await CancelIntentsAsync([hold.ExistingIntentId], cancellationToken);
        }

        var customerId = await CustomerIdAsync(hold.StripeCustomerId, hold.Email, userId, cancellationToken);
        Session session;
        try
        {
            session = await CreateSocialSessionAsync(hold, customerId, successUrl, cancelUrl, includePayTo: true, hold.Requoted, cancellationToken);
        }
        catch (StripeException exception) when (MentionsPayTo(exception))
        {
            try
            {
                session = await CreateSocialSessionAsync(hold, customerId, successUrl, cancelUrl, includePayTo: false, hold.Requoted, cancellationToken);
            }
            catch (StripeException retry)
            {
                await bookings.ReleaseSocialGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
                return SocialCheckoutResponse.Fail(retry.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
            }
        }
        catch (StripeException exception)
        {
            await bookings.ReleaseSocialGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail(exception.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        if (string.IsNullOrWhiteSpace(session.Url))
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await bookings.ReleaseSocialGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail("The payment page could not be opened.", StatusCodes.Status502BadGateway);
        }

        try
        {
            await bookings.AttachSocialPaymentAsync(hold.RegistrationId, userId, customerId, session.Id, hold.Amount, hold.Currency, cancellationToken);
        }
        catch
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await bookings.ReleaseSocialGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail("The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        return SocialCheckoutResponse.From(hold, session.Url);
    }

    public async Task<SocialCheckoutResponse> FriendCheckoutAsync(
        Guid venueId,
        Guid socialId,
        Guid userId,
        string currency,
        int requestedPoints,
        string? promotionCode,
        IReadOnlyList<string> names,
        string successUrl,
        string cancelUrl,
        CancellationToken cancellationToken)
    {
        if (settings.IsConfigured)
        {
            StripeConfiguration.ApiKey = settings.SecretKey;
        }

        await bookings.ExpirePublicSocialHoldsAsync(cancellationToken);
        var hold = await bookings.BeginFriendCheckoutAsync(venueId, socialId, userId, currency, requestedPoints, promotionCode, names, cancellationToken);
        if (hold.Error is not null)
        {
            return SocialCheckoutResponse.Fail(hold.Error, hold.StatusCode);
        }

        if (!hold.NeedsPayment || hold.CheckoutGroupId is null)
        {
            return SocialCheckoutResponse.From(hold, null) with { FriendGroupId = hold.CheckoutGroupId };
        }

        if (hold.Amount > 0 && !settings.IsConfigured)
        {
            await bookings.ReleaseFriendGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail("Card payments are not configured yet.", StatusCodes.Status503ServiceUnavailable);
        }

        if (!string.IsNullOrWhiteSpace(hold.ExistingIntentId))
        {
            await bookings.CancelSocialPaymentAsync(hold.ExistingIntentId, cancellationToken);
            await CancelIntentsAsync([hold.ExistingIntentId], cancellationToken);
        }

        var customerId = await CustomerIdAsync(hold.StripeCustomerId, hold.Email, userId, cancellationToken);
        Session session;
        try
        {
            session = await CreateFriendSessionAsync(hold, customerId, successUrl, cancelUrl, includePayTo: true, hold.Requoted, cancellationToken);
        }
        catch (StripeException exception) when (MentionsPayTo(exception))
        {
            try
            {
                session = await CreateFriendSessionAsync(hold, customerId, successUrl, cancelUrl, includePayTo: false, hold.Requoted, cancellationToken);
            }
            catch (StripeException retry)
            {
                await bookings.ReleaseFriendGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
                return SocialCheckoutResponse.Fail(retry.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
            }
        }
        catch (StripeException exception)
        {
            await bookings.ReleaseFriendGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail(exception.StripeError?.Message ?? "The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        if (string.IsNullOrWhiteSpace(session.Url))
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await bookings.ReleaseFriendGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail("The payment page could not be opened.", StatusCodes.Status502BadGateway);
        }

        try
        {
            await bookings.AttachFriendPaymentAsync(hold.RegistrationId, hold.CheckoutGroupId.Value, userId, customerId, session.Id, hold.Amount, hold.Currency, cancellationToken);
        }
        catch
        {
            await CancelIntentsAsync([session.Id], cancellationToken);
            await bookings.ReleaseFriendGroupAsync(hold.CheckoutGroupId.Value, cancellationToken);
            return SocialCheckoutResponse.Fail("The payment could not be started.", StatusCodes.Status502BadGateway);
        }

        return SocialCheckoutResponse.From(hold, session.Url) with { FriendGroupId = hold.CheckoutGroupId };
    }

    public async Task<CancelResponse> CancelFriendAsync(Guid userId, Guid friendId, CancellationToken cancellationToken)
    {
        var context = await bookings.LoadFriendCancelAsync(userId, friendId, cancellationToken);
        if (context is null)
        {
            return CancelResponse.Fail("That friend was not found.", StatusCodes.Status404NotFound);
        }

        if (context.Status is not ("confirmed" or "waitlist") || context.StartTime <= DateTime.UtcNow)
        {
            return CancelResponse.Fail("This friend can no longer be cancelled.", StatusCodes.Status409Conflict);
        }

        var late = DateTime.SpecifyKind(context.StartTime, DateTimeKind.Utc) <= DateTime.UtcNow.AddHours(24);
        var fee = context.PaymentStatus == "succeeded" && late ? context.LateCancelFeePercent : 0m;
        string? refundId = null;
        var refundStatus = "succeeded";
        decimal refundAmount = 0m;
        if (context.PaymentStatus == "succeeded"
            && context.ShareAmount > 0
            && context.PaymentId is not null
            && !string.IsNullOrWhiteSpace(context.StripePaymentIntentId)
            && !context.StripePaymentIntentId.StartsWith("cs_", StringComparison.Ordinal))
        {
            refundAmount = decimal.Round(context.ShareAmount * (100m - fee) / 100m, 2, MidpointRounding.AwayFromZero);
            if (refundAmount > context.ShareAmount)
            {
                refundAmount = context.ShareAmount;
            }

            var already = await bookings.RefundedSocialAmountAsync(context.PaymentId.Value, cancellationToken);
            var room = context.ChargedAmount - already;
            if (room < 0)
            {
                room = 0;
            }

            if (refundAmount > room)
            {
                refundAmount = room;
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
                        new RequestOptions { IdempotencyKey = "refund-friend-" + friendId.ToString("N") },
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

        string? paymentStatus = context.PaymentStatus switch
        {
            "succeeded" when refundAmount <= 0 => null,
            "succeeded" when refundAmount >= context.ChargedAmount => "refunded",
            "succeeded" => "partially_refunded",
            _ => null,
        };
        var restored = await bookings.CompleteFriendCancelAsync(
            new SocialCancelWrite(context.Id, userId, fee, context.PaymentId, paymentStatus, refundId, refundAmount, refundStatus),
            cancellationToken);
        if (restored is null)
        {
            return CancelResponse.Fail("This friend can no longer be cancelled.", StatusCodes.Status409Conflict);
        }

        return new CancelResponse(StatusCodes.Status200OK, null, refundAmount, fee, restored.Value, context.Currency);
    }

    public async Task<CancelResponse> CancelSocialAsync(Guid userId, Guid registrationId, CancellationToken cancellationToken)
    {
        var context = await bookings.LoadSocialCancelAsync(userId, registrationId, cancellationToken);
        if (context is null)
        {
            return CancelResponse.Fail("That booking was not found.", StatusCodes.Status404NotFound);
        }

        if (context.Status is not ("pending" or "confirmed" or "waitlist") || context.StartTime <= DateTime.UtcNow)
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
            && !string.IsNullOrWhiteSpace(context.StripePaymentIntentId)
            && !context.StripePaymentIntentId.StartsWith("cs_", StringComparison.Ordinal))
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
                        new RequestOptions { IdempotencyKey = "refund-social-" + registrationId.ToString("N") },
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

        string? paymentStatus = context.PaymentStatus switch
        {
            "succeeded" when refundAmount <= 0 => null,
            "succeeded" when refundAmount >= context.PaymentAmount => "refunded",
            "succeeded" => "partially_refunded",
            "pending" => "cancelled",
            _ => null,
        };
        var saved = await bookings.CompleteSocialCancelAsync(
            new SocialCancelWrite(context.Id, userId, fee, context.PaymentId, paymentStatus, refundId, refundAmount, refundStatus),
            cancellationToken);
        if (!saved)
        {
            return CancelResponse.Fail("This booking can no longer be cancelled.", StatusCodes.Status409Conflict);
        }

        return new CancelResponse(StatusCodes.Status200OK, null, refundAmount, fee, 0, context.Currency);
    }

    private async Task<SocialCheckoutResponse?> ResumeSocialCheckoutAsync(
        SocialCheckoutHold hold,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var intentId = hold.ExistingIntentId!;
        if (intentId.StartsWith("cs_", StringComparison.Ordinal))
        {
            Session existing;
            try
            {
                existing = await new SessionService().GetAsync(intentId, cancellationToken: cancellationToken);
            }
            catch (StripeException)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(existing.PaymentIntentId))
            {
                await bookings.BindSocialPaymentIntentAsync(hold.RegistrationId, existing.PaymentIntentId, cancellationToken);
                var paid = await new PaymentIntentService().GetAsync(existing.PaymentIntentId, cancellationToken: cancellationToken);
                await ApplySocialIntentAsync(paid, cancellationToken);
                var current = await bookings.FindOwnedSocialAsync(userId, hold.RegistrationId, cancellationToken);
                if (current is { Status: "confirmed" })
                {
                    return SocialCheckoutResponse.From(hold, null) with { Status = "confirmed", AlreadyJoined = true, CourtName = current.CourtName, CourtNumber = current.CourtNumber };
                }

                if (current is { Status: "expired" or "cancelled" })
                {
                    return SocialCheckoutResponse.Fail("The payment failed and the seat was released. Register again.", StatusCodes.Status409Conflict);
                }
            }

            if (existing.Status == "open" && !string.IsNullOrWhiteSpace(existing.Url))
            {
                return SocialCheckoutResponse.From(hold, existing.Url);
            }

            await CancelIntentsAsync([existing.Id], cancellationToken);
            return null;
        }

        var intent = await new PaymentIntentService().GetAsync(intentId, cancellationToken: cancellationToken);
        await ApplySocialIntentAsync(intent, cancellationToken);
        var owned = await bookings.FindOwnedSocialAsync(userId, hold.RegistrationId, cancellationToken);
        if (owned is { Status: "confirmed" })
        {
            return SocialCheckoutResponse.From(hold, null) with { Status = "confirmed", AlreadyJoined = true, CourtName = owned.CourtName, CourtNumber = owned.CourtNumber };
        }

        if (intent.Status == "processing")
        {
            return SocialCheckoutResponse.From(hold, null);
        }

        await CancelIntentsAsync([intentId], cancellationToken);
        return null;
    }

    private async Task<bool> ApplySocialCheckoutAsync(string eventType, Session session, CancellationToken cancellationToken)
    {
        if (eventType == "checkout.session.expired")
        {
            await bookings.FailSocialPendingAsync(session.Id, "cancelled", cancellationToken);
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

        var registrationRaw = session.ClientReferenceId;
        if (string.IsNullOrWhiteSpace(registrationRaw) && session.Metadata is not null)
        {
            session.Metadata.TryGetValue("registrationId", out registrationRaw);
        }

        if (!Guid.TryParse(registrationRaw, out var registrationId)
            || !await bookings.BindSocialPaymentIntentAsync(registrationId, session.PaymentIntentId, cancellationToken))
        {
            return false;
        }

        var intent = await new PaymentIntentService().GetAsync(session.PaymentIntentId, cancellationToken: cancellationToken);
        if (eventType == "checkout.session.async_payment_failed")
        {
            await bookings.FailSocialPendingAsync(intent.Id, "failed", cancellationToken);
            return true;
        }

        await ApplySocialIntentAsync(intent, cancellationToken);
        return true;
    }

    public async Task RefundStartedWaitlistsAsync(CancellationToken cancellationToken)
    {
        if (settings.IsConfigured)
        {
            StripeConfiguration.ApiKey = settings.SecretKey;
        }

        var rows = await bookings.ListStartedWaitlistsAsync(cancellationToken);
        foreach (var row in rows)
        {
            var cardPaid = row.Amount > 0
                && row.PaymentStatus == "succeeded"
                && !string.IsNullOrWhiteSpace(row.StripePaymentIntentId)
                && !row.StripePaymentIntentId.StartsWith("cs_", StringComparison.Ordinal);
            if (cardPaid)
            {
                if (!settings.IsConfigured)
                {
                    continue;
                }

                try
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions { PaymentIntent = row.StripePaymentIntentId, Amount = Cents(row.Amount) },
                        new RequestOptions { IdempotencyKey = "refund-waitlist-start-" + row.Id.ToString("N") },
                        cancellationToken);
                    await bookings.CompleteStartedWaitlistAsync(row.Id, refund.Id, MapRefundStatus(refund.Status), cancellationToken);
                }
                catch (StripeException)
                {
                    // Leave the waitlist row so the next page load can try the refund again.
                }

                continue;
            }

            await bookings.CompleteStartedWaitlistAsync(row.Id, null, "succeeded", cancellationToken);
        }

        var friends = await bookings.ListStartedFriendWaitlistsAsync(cancellationToken);
        foreach (var row in friends)
        {
            var cardPaid = row.Amount > 0
                && row.PaymentStatus is "succeeded" or "partially_refunded"
                && !string.IsNullOrWhiteSpace(row.StripePaymentIntentId)
                && !row.StripePaymentIntentId.StartsWith("cs_", StringComparison.Ordinal);
            if (cardPaid)
            {
                if (!settings.IsConfigured)
                {
                    continue;
                }

                try
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions { PaymentIntent = row.StripePaymentIntentId, Amount = Cents(row.Amount) },
                        new RequestOptions { IdempotencyKey = "refund-friend-waitlist-start-" + row.Id.ToString("N") },
                        cancellationToken);
                    await bookings.CompleteStartedFriendWaitlistAsync(row.Id, refund.Id, MapRefundStatus(refund.Status), cancellationToken);
                }
                catch (StripeException)
                {
                    // Leave the friend on the waitlist so the next page load can try the refund again.
                }

                continue;
            }

            await bookings.CompleteStartedFriendWaitlistAsync(row.Id, null, "succeeded", cancellationToken);
        }
    }

    private async Task<bool> ApplyWaitlistCheckoutAsync(string eventType, Session session, CancellationToken cancellationToken)
    {
        if (eventType == "checkout.session.expired")
        {
            await bookings.FailSocialPendingAsync(session.Id, "cancelled", cancellationToken);
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

        var registrationRaw = session.ClientReferenceId;
        if (string.IsNullOrWhiteSpace(registrationRaw) && session.Metadata is not null)
        {
            session.Metadata.TryGetValue("registrationId", out registrationRaw);
        }

        if (!Guid.TryParse(registrationRaw, out var registrationId)
            || !await bookings.BindSocialPaymentIntentAsync(registrationId, session.PaymentIntentId, cancellationToken))
        {
            return false;
        }

        var intent = await new PaymentIntentService().GetAsync(session.PaymentIntentId, cancellationToken: cancellationToken);
        if (eventType == "checkout.session.async_payment_failed")
        {
            await bookings.FailSocialPendingAsync(intent.Id, "failed", cancellationToken);
            return true;
        }

        await ApplyWaitlistIntentAsync(intent, cancellationToken);
        return true;
    }

    private async Task ApplyWaitlistIntentAsync(PaymentIntent intent, CancellationToken cancellationToken)
    {
        if (intent.Metadata is not null
            && intent.Metadata.TryGetValue("registrationId", out var registrationRaw)
            && Guid.TryParse(registrationRaw, out var registrationId))
        {
            await bookings.BindSocialPaymentIntentAsync(registrationId, intent.Id, cancellationToken);
        }

        switch (intent.Status)
        {
            case "succeeded":
                var transition = await bookings.MarkWaitlistPaidAsync(intent.Id, intent.LatestChargeId, cancellationToken);
                if (transition is { Action: "refund", Amount: > 0 })
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions { PaymentIntent = intent.Id, Amount = Cents(transition.Amount) },
                        new RequestOptions { IdempotencyKey = "refund-waitlist-late-" + transition.RegistrationId.ToString("N") },
                        cancellationToken);
                    await bookings.RecordSocialRefundAsync(intent.Id, refund.Id, transition.Amount, MapRefundStatus(refund.Status), cancellationToken);
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
                    await bookings.ExtendSocialHoldAsync(intent.Id, until.Value, cancellationToken);
                }

                return;
            case "canceled":
                await bookings.FailSocialPendingAsync(intent.Id, "cancelled", cancellationToken);
                return;
        }
    }

    private async Task ApplySocialIntentAsync(PaymentIntent intent, CancellationToken cancellationToken)
    {
        if (intent.Metadata is not null
            && intent.Metadata.TryGetValue("registrationId", out var registrationRaw)
            && Guid.TryParse(registrationRaw, out var registrationId))
        {
            await bookings.BindSocialPaymentIntentAsync(registrationId, intent.Id, cancellationToken);
        }

        switch (intent.Status)
        {
            case "succeeded":
                var transition = await bookings.MarkSocialSucceededAsync(intent.Id, intent.LatestChargeId, cancellationToken);
                if (transition is { Action: "refund", Amount: > 0 })
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions { PaymentIntent = intent.Id, Amount = Cents(transition.Amount) },
                        new RequestOptions { IdempotencyKey = "refund-social-late-" + transition.RegistrationId.ToString("N") },
                        cancellationToken);
                    await bookings.RecordSocialRefundAsync(intent.Id, refund.Id, transition.Amount, MapRefundStatus(refund.Status), cancellationToken);
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
                    await bookings.ExtendSocialHoldAsync(intent.Id, until.Value, cancellationToken);
                }

                return;
            case "canceled":
                await bookings.FailSocialPendingAsync(intent.Id, "cancelled", cancellationToken);
                return;
        }
    }

    private static async Task<Session> CreateSocialSessionAsync(
        SocialCheckoutHold hold,
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

        var key = (hold.Waitlist ? "waitlist-checkout-" : "social-checkout-") + hold.RegistrationId.ToString("N");
        if (!includePayTo)
        {
            key += "-card";
        }

        if (replacement)
        {
            key += "-" + Guid.NewGuid().ToString("N");
        }

        var metadata = new Dictionary<string, string>
        {
            ["kind"] = hold.Waitlist ? "social-waitlist" : "social",
            ["registrationId"] = hold.RegistrationId.ToString(),
        };
        return await new SessionService().CreateAsync(
            new SessionCreateOptions
            {
                Mode = "payment",
                Customer = customerId,
                SuccessUrl = successUrl,
                CancelUrl = cancelUrl,
                PaymentMethodTypes = types,
                ClientReferenceId = hold.RegistrationId.ToString(),
                Metadata = metadata,
                PaymentIntentData = new SessionPaymentIntentDataOptions
                {
                    ReceiptEmail = string.IsNullOrWhiteSpace(hold.Email) ? null : hold.Email,
                    Metadata = metadata,
                },
                LineItems =
                [
                    new SessionLineItemOptions
                    {
                        Quantity = 1,
                        PriceData = new SessionLineItemPriceDataOptions
                        {
                            Currency = hold.Currency.ToLowerInvariant(),
                            UnitAmount = Cents(hold.Amount),
                            ProductData = new SessionLineItemPriceDataProductDataOptions { Name = hold.Waitlist ? "Drop-in social waitlist" : "Drop-in social" },
                        },
                    },
                ],
            },
            new RequestOptions { IdempotencyKey = key },
            cancellationToken);
    }

    private async Task<bool> ApplyFriendCheckoutAsync(string eventType, Session session, CancellationToken cancellationToken)
    {
        if (eventType == "checkout.session.expired")
        {
            await bookings.FailFriendPendingAsync(session.Id, "cancelled", cancellationToken);
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

        var groupRaw = session.ClientReferenceId;
        if (string.IsNullOrWhiteSpace(groupRaw) && session.Metadata is not null)
        {
            session.Metadata.TryGetValue("friendGroupId", out groupRaw);
        }

        if (!Guid.TryParse(groupRaw, out var friendGroupId)
            || !await bookings.BindFriendPaymentIntentAsync(friendGroupId, session.PaymentIntentId, cancellationToken))
        {
            return false;
        }

        var intent = await new PaymentIntentService().GetAsync(session.PaymentIntentId, cancellationToken: cancellationToken);
        if (eventType == "checkout.session.async_payment_failed")
        {
            await bookings.FailFriendPendingAsync(intent.Id, "failed", cancellationToken);
            return true;
        }

        await ApplyFriendIntentAsync(intent, cancellationToken);
        return true;
    }

    private async Task ApplyFriendIntentAsync(PaymentIntent intent, CancellationToken cancellationToken)
    {
        if (intent.Metadata is not null
            && intent.Metadata.TryGetValue("friendGroupId", out var groupRaw)
            && Guid.TryParse(groupRaw, out var friendGroupId))
        {
            await bookings.BindFriendPaymentIntentAsync(friendGroupId, intent.Id, cancellationToken);
        }

        switch (intent.Status)
        {
            case "succeeded":
                var transition = await bookings.MarkFriendSucceededAsync(intent.Id, intent.LatestChargeId, cancellationToken);
                if (transition is { Action: "refund", Amount: > 0 })
                {
                    var refund = await new RefundService().CreateAsync(
                        new RefundCreateOptions { PaymentIntent = intent.Id, Amount = Cents(transition.Amount) },
                        new RequestOptions { IdempotencyKey = "refund-friend-late-" + transition.RegistrationId.ToString("N") },
                        cancellationToken);
                    await bookings.RecordSocialRefundAsync(intent.Id, refund.Id, transition.Amount, MapRefundStatus(refund.Status), cancellationToken);
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
                    await bookings.ExtendFriendHoldAsync(intent.Id, until.Value, cancellationToken);
                }

                return;
            case "canceled":
                await bookings.FailFriendPendingAsync(intent.Id, "cancelled", cancellationToken);
                return;
        }
    }

    private static async Task<Session> CreateFriendSessionAsync(
        SocialCheckoutHold hold,
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

        var groupId = hold.CheckoutGroupId ?? hold.RegistrationId;
        var key = "friend-checkout-" + groupId.ToString("N");
        if (!includePayTo)
        {
            key += "-card";
        }

        if (replacement)
        {
            key += "-" + Guid.NewGuid().ToString("N");
        }

        var people = hold.FriendCount == 1 ? "1 friend" : $"{hold.FriendCount} friends";
        var metadata = new Dictionary<string, string>
        {
            ["kind"] = "social-friends",
            ["registrationId"] = hold.RegistrationId.ToString(),
            ["friendGroupId"] = groupId.ToString(),
        };
        return await new SessionService().CreateAsync(
            new SessionCreateOptions
            {
                Mode = "payment",
                Customer = customerId,
                SuccessUrl = successUrl,
                CancelUrl = cancelUrl,
                PaymentMethodTypes = types,
                ClientReferenceId = groupId.ToString(),
                Metadata = metadata,
                PaymentIntentData = new SessionPaymentIntentDataOptions
                {
                    ReceiptEmail = string.IsNullOrWhiteSpace(hold.Email) ? null : hold.Email,
                    Metadata = metadata,
                },
                LineItems =
                [
                    new SessionLineItemOptions
                    {
                        Quantity = 1,
                        PriceData = new SessionLineItemPriceDataOptions
                        {
                            Currency = hold.Currency.ToLowerInvariant(),
                            UnitAmount = Cents(hold.Amount),
                            ProductData = new SessionLineItemPriceDataProductDataOptions { Name = hold.Waitlist ? $"Drop-in social waitlist · {people}" : $"Drop-in social · {people}" },
                        },
                    },
                ],
            },
            new RequestOptions { IdempotencyKey = key },
            cancellationToken);
    }

    private static bool IsFriend(IDictionary<string, string>? metadata) =>
        metadata is not null && metadata.TryGetValue("kind", out var kind) && kind == "social-friends";

    private static bool IsWaitlist(IDictionary<string, string>? metadata) =>
        metadata is not null && metadata.TryGetValue("kind", out var kind) && kind == "social-waitlist";

    private static bool IsSocial(IDictionary<string, string>? metadata) =>
        metadata is not null && metadata.TryGetValue("kind", out var kind) && kind == "social";

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

public sealed record SocialCheckoutResponse(
    int StatusCode,
    string? Error,
    Guid RegistrationId,
    string Status,
    string? CheckoutUrl,
    decimal Amount,
    string Currency,
    string CourtName,
    int CourtNumber,
    bool AlreadyJoined,
    decimal Subtotal,
    decimal DiscountAmount,
    int PointsRedeemed,
    decimal PointsValue,
    int IncentivePoints,
    Guid? FriendGroupId = null)
{
    public static SocialCheckoutResponse Fail(string error, int statusCode) =>
        new(statusCode, error, Guid.Empty, "", null, 0, "AUD", "", 0, false, 0, 0, 0, 0, 0);

    public static SocialCheckoutResponse From(SocialCheckoutHold hold, string? checkoutUrl) =>
        new(StatusCodes.Status200OK, null, hold.RegistrationId, hold.Status, checkoutUrl, hold.Amount, hold.Currency, hold.CourtName, hold.CourtNumber, hold.AlreadyJoined, hold.Subtotal, hold.DiscountAmount, hold.PointsRedeemed, hold.PointsValue, hold.IncentivePoints);
}
