using Dapper;
using MySqlConnector;

namespace ShuttleSync.Api.Data;

public sealed class PaymentRepository(IConfiguration configuration)
{
    public async Task<IReadOnlyList<string>> ReleaseExpiredHoldsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var rows = (await connection.QueryAsync<ExpiredHoldRow>(new CommandDefinition(
            """
            SELECT b.Id, b.UserId,
                   CAST(COALESCE((
                       SELECT r.Points - r.PointsRestored
                       FROM RewardPointRedemptions r
                       WHERE r.BookingId = b.Id
                   ), 0) AS SIGNED) AS PointsToRestore,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM Payments p
                       WHERE p.BookingId = b.Id AND p.Status = 'pending'
                       ORDER BY p.CreatedAt DESC
                       LIMIT 1
                   ) AS StripePaymentIntentId
            FROM Bookings b
            WHERE b.Status = 'pending' AND b.IsDeleted = 0
              AND b.HoldExpiresAt IS NOT NULL
              AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
            FOR UPDATE
            """,
            transaction: tx,
            cancellationToken: cancellationToken))).ToArray();

        var intents = new List<string>();
        foreach (var row in rows)
        {
            await ExpireBookingAsync(connection, tx, row.Id, row.UserId, row.PointsToRestore, "cancelled", null, null, cancellationToken);
            if (!string.IsNullOrWhiteSpace(row.StripePaymentIntentId))
            {
                intents.Add(row.StripePaymentIntentId);
            }
        }

        await tx.CommitAsync(cancellationToken);
        return intents;
    }

    public async Task<CheckoutPrepared> PrepareCheckoutAsync(
        Guid venueId,
        Guid sessionId,
        Guid userId,
        int requestedPoints,
        string? promotionCode,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var slot = await connection.QuerySingleOrDefaultAsync<CheckoutSlotRow>(new CommandDefinition(
            """
            SELECT cs.Id, cs.CourtId, cs.Price, cs.StartTime, cs.EndTime, v.Currency, v.PointsPerDollar,
                   c.IsActive AS CourtActive, c.IsDeleted AS CourtDeleted
            FROM CourtSessions cs
            JOIN Venues v ON v.Id = cs.VenueId AND v.IsDeleted = 0 AND v.IsActive = 1
            JOIN Courts c ON c.Id = cs.CourtId AND c.VenueId = cs.VenueId
            WHERE cs.Id = @Id AND cs.VenueId = @VenueId AND cs.IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = sessionId, VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (slot is null)
        {
            return CheckoutPrepared.Fail("That slot was not found.", StatusCodes.Status404NotFound);
        }

        if (slot.CourtDeleted || !slot.CourtActive)
        {
            return CheckoutPrepared.Fail("This court is not available for that session.", StatusCodes.Status409Conflict);
        }

        if (slot.StartTime <= DateTime.UtcNow)
        {
            return CheckoutPrepared.Fail("This session has already started.", StatusCodes.Status409Conflict);
        }

        var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*)
            FROM CourtClosures
            WHERE VenueId = @VenueId
              AND (CourtId = @CourtId OR CourtId IS NULL)
              AND StartTime < @EndTime AND EndTime > @StartTime
            """,
            new { VenueId = venueId, slot.CourtId, slot.StartTime, slot.EndTime },
            tx,
            cancellationToken: cancellationToken));
        if (closed > 0)
        {
            return CheckoutPrepared.Fail("This court is closed for that session.", StatusCodes.Status409Conflict);
        }

        var active = await connection.QuerySingleOrDefaultAsync<ActiveBookingRow>(new CommandDefinition(
            """
            SELECT b.Id, b.UserId, b.Status, b.SubtotalAmount, b.TotalAmount, b.PointsRedeemed, b.PointsValue,
                   (
                       SELECT p.StripePaymentIntentId
                       FROM Payments p
                       WHERE p.BookingId = b.Id AND p.Status IN ('pending', 'succeeded')
                       ORDER BY p.CreatedAt DESC
                       LIMIT 1
                   ) AS StripePaymentIntentId
            FROM Bookings b
            WHERE b.CourtSessionId = @SessionId AND b.IsDeleted = 0
              AND b.Status NOT IN ('cancelled', 'expired')
              AND NOT (
                  b.Status = 'pending'
                  AND b.HoldExpiresAt IS NOT NULL
                  AND b.HoldExpiresAt <= UTC_TIMESTAMP(6)
              )
            FOR UPDATE
            """,
            new { SessionId = sessionId },
            tx,
            cancellationToken: cancellationToken));
        if (active is not null)
        {
            if (active.UserId == userId && active.Status == "pending")
            {
                var payer = await connection.QuerySingleOrDefaultAsync<CheckoutUserRow>(new CommandDefinition(
                    """
                    SELECT Email, RewardPoints, StripeCustomerId
                    FROM Users
                    WHERE Id = @Id AND IsDeleted = 0
                    """,
                    new { Id = userId },
                    tx,
                    cancellationToken: cancellationToken));
                await tx.CommitAsync(cancellationToken);
                return new CheckoutPrepared
                {
                    BookingId = active.Id,
                    Status = "pending",
                    ExistingIntentId = active.StripePaymentIntentId,
                    NeedsPayment = true,
                    Subtotal = active.SubtotalAmount,
                    Points = active.PointsRedeemed,
                    PointsValue = active.PointsValue,
                    Cash = active.TotalAmount,
                    Currency = slot.Currency,
                    Email = payer?.Email ?? "",
                    StripeCustomerId = payer?.StripeCustomerId,
                    UserId = userId,
                    VenueId = venueId,
                    SessionId = sessionId,
                };
            }

            var message = active.UserId == userId
                ? "You already have this booking."
                : "This slot is already booked.";
            return CheckoutPrepared.Fail(message, StatusCodes.Status409Conflict);
        }

        var account = await connection.QuerySingleOrDefaultAsync<CheckoutUserRow>(new CommandDefinition(
            """
            SELECT Email, RewardPoints, StripeCustomerId
            FROM Users
            WHERE Id = @Id AND IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = userId },
            tx,
            cancellationToken: cancellationToken));
        if (account is null)
        {
            return CheckoutPrepared.Fail("Sign in again.", StatusCodes.Status401Unauthorized);
        }

        var (promoId, discount, promoError) = await LockPromotionAsync(connection, tx, venueId, userId, slot.Price, promotionCode, cancellationToken);
        if (promoError is not null)
        {
            return CheckoutPrepared.Fail(promoError, StatusCodes.Status400BadRequest);
        }

        var (points, value, cash, error) = Quote(requestedPoints, account.RewardPoints, slot.PointsPerDollar, slot.Price - discount);
        if (error is not null)
        {
            return CheckoutPrepared.Fail(error, StatusCodes.Status400BadRequest);
        }

        var bookingId = Guid.NewGuid();
        var pending = cash > 0;
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO Bookings
                    (Id, VenueId, UserId, CourtSessionId, Status, PromotionCodeId, SubtotalAmount, DiscountAmount, PointsRedeemed,
                     PointsValue, TotalAmount, HoldExpiresAt, ConfirmedAt, IsDeleted, CreatedAt, UpdatedAt)
                VALUES
                    (@Id, @VenueId, @UserId, @SessionId, @Status, @PromotionCodeId, @Price, @Discount, @Points, @PointsValue, @Cash,
                     CASE WHEN @Pending = 1 THEN DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 30 MINUTE) ELSE NULL END,
                     CASE WHEN @Pending = 1 THEN NULL ELSE UTC_TIMESTAMP(6) END,
                     0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = bookingId,
                    VenueId = venueId,
                    UserId = userId,
                    SessionId = sessionId,
                    Status = pending ? "pending" : "confirmed",
                    PromotionCodeId = promoId,
                    Price = slot.Price,
                    Discount = discount,
                    Points = points,
                    PointsValue = value,
                    Cash = cash,
                    Pending = pending ? 1 : 0,
                },
                tx,
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return CheckoutPrepared.Fail("This slot was just booked.", StatusCodes.Status409Conflict);
        }

        if (points > 0)
        {
            var spent = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints - @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND RewardPoints >= @Points
                """,
                new { Id = userId, Points = points },
                tx,
                cancellationToken: cancellationToken));
            if (spent != 1)
            {
                return CheckoutPrepared.Fail("You do not have enough reward points.", StatusCodes.Status409Conflict);
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO RewardPointRedemptions
                    (Id, UserId, BookingId, Points, Amount, PointsRestored, CreatedAt)
                VALUES
                    (@Id, @UserId, @BookingId, @Points, @Amount, 0, UTC_TIMESTAMP(6))
                """,
                new { Id = Guid.NewGuid(), UserId = userId, BookingId = bookingId, Points = points, Amount = value },
                tx,
                cancellationToken: cancellationToken));
        }

        if (promoId is not null)
        {
            var counted = await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE PromotionCodes
                SET UsedCount = UsedCount + 1, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND (MaxUses IS NULL OR UsedCount < MaxUses)
                """,
                new { Id = promoId },
                tx,
                cancellationToken: cancellationToken));
            if (counted != 1)
            {
                return CheckoutPrepared.Fail("That promotion code has been used up.", StatusCodes.Status409Conflict);
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO PromotionRedemptions
                    (Id, PromotionCodeId, UserId, BookingId, DiscountAmount, CreatedAt)
                VALUES
                    (@Id, @PromotionCodeId, @UserId, @BookingId, @Discount, UTC_TIMESTAMP(6))
                """,
                new { Id = Guid.NewGuid(), PromotionCodeId = promoId, UserId = userId, BookingId = bookingId, Discount = discount },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        return new CheckoutPrepared
        {
            BookingId = bookingId,
            Status = pending ? "pending" : "confirmed",
            NeedsPayment = pending,
            Subtotal = slot.Price,
            Points = points,
            PointsValue = value,
            Cash = cash,
            Discount = discount,
            Currency = slot.Currency,
            Email = account.Email,
            StripeCustomerId = account.StripeCustomerId,
            UserId = userId,
            VenueId = venueId,
            SessionId = sessionId,
        };
    }

    public async Task CancelPendingPaymentRowAsync(Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Payments
            SET Status = 'cancelled', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE BookingId = @Id AND Status = 'pending'
            """,
            new { Id = bookingId },
            cancellationToken: cancellationToken));
    }

    public async Task AttachPaymentAsync(
        Guid bookingId,
        Guid userId,
        string? customerId,
        string intentId,
        decimal amount,
        string currency,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        if (!string.IsNullOrWhiteSpace(customerId))
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET StripeCustomerId = @CustomerId, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND (StripeCustomerId IS NULL OR StripeCustomerId = @CustomerId)
                """,
                new { Id = userId, CustomerId = customerId },
                tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO Payments
                (Id, BookingId, StripePaymentIntentId, Amount, Currency, Status, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @BookingId, @IntentId, @Amount, @Currency, 'pending', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            """,
            new
            {
                Id = Guid.NewGuid(),
                BookingId = bookingId,
                IntentId = intentId,
                Amount = amount,
                Currency = currency,
            },
            tx,
            cancellationToken: cancellationToken));
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<bool> BindPaymentIntentAsync(Guid bookingId, string intentId, CancellationToken cancellationToken)
    {
        if (await PaymentExistsAsync(intentId, cancellationToken))
        {
            return true;
        }

        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Payments
            SET StripePaymentIntentId = @IntentId, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE BookingId = @BookingId
              AND Status = 'pending'
              AND StripePaymentIntentId <> @IntentId
            ORDER BY CreatedAt DESC
            LIMIT 1
            """,
            new { BookingId = bookingId, IntentId = intentId },
            cancellationToken: cancellationToken));
        return await PaymentExistsAsync(intentId, cancellationToken);
    }

    public async Task RollbackPendingAsync(Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<ExpiredHoldRow>(new CommandDefinition(
            """
            SELECT b.Id, b.UserId,
                   CAST(COALESCE((
                       SELECT r.Points - r.PointsRestored
                       FROM RewardPointRedemptions r
                       WHERE r.BookingId = b.Id
                   ), 0) AS SIGNED) AS PointsToRestore,
                   NULL AS StripePaymentIntentId
            FROM Bookings b
            WHERE b.Id = @Id AND b.Status = 'pending' AND b.IsDeleted = 0
            FOR UPDATE
            """,
            new { Id = bookingId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return;
        }

        await ExpireBookingAsync(connection, tx, row.Id, row.UserId, row.PointsToRestore, "cancelled", null, null, cancellationToken);
        await tx.CommitAsync(cancellationToken);
    }

    public async Task<PaymentTransition?> MarkSucceededAsync(string intentId, string? chargeId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<PaymentStateRow>(new CommandDefinition(
            """
            SELECT b.Id AS BookingId, b.Status, b.UserId, b.VenueId, b.CourtSessionId AS SessionId,
                   p.Id AS PaymentId, p.Status AS PaymentStatus, p.Amount
            FROM Payments p
            JOIN Bookings b ON b.Id = p.BookingId
            WHERE p.StripePaymentIntentId = @IntentId
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return null;
        }

        if (row.PaymentStatus is "pending" or "failed")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Payments
                SET Status = 'succeeded', StripeChargeId = @ChargeId, PaidAt = UTC_TIMESTAMP(6), UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = row.PaymentId, ChargeId = chargeId },
                tx,
                cancellationToken: cancellationToken));
        }

        var action = row.Status switch
        {
            "pending" => "confirmed",
            "expired" or "cancelled" => "refund",
            _ => "already",
        };
        if (action == "confirmed")
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Bookings
                SET Status = 'confirmed', ConfirmedAt = UTC_TIMESTAMP(6), HoldExpiresAt = NULL, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id AND Status = 'pending'
                """,
                new { Id = row.BookingId },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        return new PaymentTransition(action, row.BookingId, row.UserId, row.VenueId, row.SessionId, row.Amount, row.PaymentStatus);
    }

    public async Task ExtendHoldAsync(string intentId, DateTime untilUtc, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings b
            JOIN Payments p ON p.BookingId = b.Id
            SET b.HoldExpiresAt = CASE
                    WHEN b.HoldExpiresAt IS NULL OR b.HoldExpiresAt < @Until THEN @Until
                    ELSE b.HoldExpiresAt
                END,
                b.UpdatedAt = UTC_TIMESTAMP(6)
            WHERE p.StripePaymentIntentId = @IntentId AND b.Status = 'pending' AND b.IsDeleted = 0
            """,
            new { IntentId = intentId, Until = untilUtc },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> FailPendingAsync(string intentId, string paymentStatus, string? code, string? message, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var row = await connection.QuerySingleOrDefaultAsync<ExpiredHoldRow>(new CommandDefinition(
            """
            SELECT b.Id, b.UserId,
                   CAST(COALESCE((
                       SELECT r.Points - r.PointsRestored
                       FROM RewardPointRedemptions r
                       WHERE r.BookingId = b.Id
                   ), 0) AS SIGNED) AS PointsToRestore,
                   p.StripePaymentIntentId
            FROM Payments p
            JOIN Bookings b ON b.Id = p.BookingId
            WHERE p.StripePaymentIntentId = @IntentId AND b.Status = 'pending' AND b.IsDeleted = 0
            FOR UPDATE
            """,
            new { IntentId = intentId },
            tx,
            cancellationToken: cancellationToken));
        if (row is null)
        {
            return false;
        }

        await ExpireBookingAsync(connection, tx, row.Id, row.UserId, row.PointsToRestore, paymentStatus, code, message, cancellationToken);
        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> PaymentExistsAsync(string intentId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var count = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            "SELECT COUNT(*) FROM Payments WHERE StripePaymentIntentId = @IntentId",
            new { IntentId = intentId },
            cancellationToken: cancellationToken));
        return count > 0;
    }

    public async Task<bool> TryRecordWebhookAsync(
        string eventId,
        string eventType,
        string? intentId,
        string payload,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO StripeWebhookEvents
                    (Id, StripeEventId, EventType, StripePaymentIntentId, Payload, Status, CreatedAt)
                VALUES
                    (@Id, @EventId, @EventType, @IntentId, CAST(@Payload AS JSON), 'received', UTC_TIMESTAMP(6))
                """,
                new { Id = Guid.NewGuid(), EventId = eventId, EventType = eventType, IntentId = intentId, Payload = payload },
                cancellationToken: cancellationToken));
            return true;
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            var status = await connection.ExecuteScalarAsync<string>(new CommandDefinition(
                "SELECT Status FROM StripeWebhookEvents WHERE StripeEventId = @EventId",
                new { EventId = eventId },
                cancellationToken: cancellationToken));
            return status != "processed";
        }
    }

    public async Task FinishWebhookAsync(string eventId, string status, string? error, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE StripeWebhookEvents
            SET Status = @Status, ErrorMessage = @Error, ProcessedAt = UTC_TIMESTAMP(6)
            WHERE StripeEventId = @EventId
            """,
            new { EventId = eventId, Status = status, Error = error },
            cancellationToken: cancellationToken));
    }

    public async Task<BookingPaymentRow?> FindOwnedPaymentAsync(Guid userId, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<BookingPaymentRow>(new CommandDefinition(
            """
            SELECT b.Id, b.Status, b.TotalAmount, b.PointsRedeemed, b.PointsValue, v.Currency,
                   p.Status AS PaymentStatus, p.StripePaymentIntentId
            FROM Bookings b
            JOIN Venues v ON v.Id = b.VenueId
            LEFT JOIN Payments p ON p.Id = (
                SELECT p2.Id FROM Payments p2 WHERE p2.BookingId = b.Id ORDER BY p2.CreatedAt DESC LIMIT 1
            )
            WHERE b.Id = @Id AND b.UserId = @UserId AND b.IsDeleted = 0
            """,
            new { Id = bookingId, UserId = userId },
            cancellationToken: cancellationToken));
    }

    public async Task<CancelContext?> LoadCancelAsync(Guid userId, Guid bookingId, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        return await connection.QuerySingleOrDefaultAsync<CancelContext>(new CommandDefinition(
            """
            SELECT b.Id, b.Status, b.UserId, b.VenueId, b.CourtSessionId AS SessionId, cs.StartTime,
                   v.Currency, v.LateCancelFeePercent, b.PointsRedeemed,
                   COALESCE(r.PointsRestored, 0) AS PointsRestored,
                   p.Id AS PaymentId, p.StripePaymentIntentId, p.Status AS PaymentStatus, COALESCE(p.Amount, 0) AS PaymentAmount
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            JOIN Venues v ON v.Id = b.VenueId
            LEFT JOIN RewardPointRedemptions r ON r.BookingId = b.Id
            LEFT JOIN Payments p ON p.Id = (
                SELECT p2.Id FROM Payments p2 WHERE p2.BookingId = b.Id ORDER BY p2.CreatedAt DESC LIMIT 1
            )
            WHERE b.Id = @Id AND b.UserId = @UserId AND b.IsDeleted = 0
            """,
            new { Id = bookingId, UserId = userId },
            cancellationToken: cancellationToken));
    }

    public async Task<bool> CompleteCancelAsync(CancelWrite write, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var changed = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId
            SET b.Status = 'cancelled',
                b.CancelledAt = UTC_TIMESTAMP(6),
                b.CancelledBy = @UserId,
                b.CancelFeePercent = @FeePercent,
                b.UpdatedAt = UTC_TIMESTAMP(6)
            WHERE b.Id = @Id AND b.UserId = @UserId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
              AND cs.StartTime > UTC_TIMESTAMP(6)
            """,
            write,
            tx,
            cancellationToken: cancellationToken));
        if (changed != 1)
        {
            return false;
        }

        if (write.PointsToRestore > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @UserId
                """,
                new { UserId = write.UserId, Points = write.PointsToRestore },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE RewardPointRedemptions
                SET PointsRestored = LEAST(Points, PointsRestored + @Points)
                WHERE BookingId = @Id
                """,
                new { Id = write.Id, Points = write.PointsToRestore },
                tx,
                cancellationToken: cancellationToken));
        }

        if (write.PaymentId is not null && write.PaymentStatus is not null)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Payments
                SET Status = @Status, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @Id
                """,
                new { Id = write.PaymentId, Status = write.PaymentStatus },
                tx,
                cancellationToken: cancellationToken));
        }

        if (!string.IsNullOrWhiteSpace(write.StripeRefundId) && write.PaymentId is not null && write.RefundAmount > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO Refunds
                    (Id, PaymentId, StripeRefundId, Amount, Reason, Status, RequestedBy, ProcessedAt, CreatedAt)
                VALUES
                    (@Id, @PaymentId, @StripeRefundId, @Amount, @Reason, @Status, @UserId,
                     CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    write.PaymentId,
                    write.StripeRefundId,
                    Amount = write.RefundAmount,
                    Reason = "Booking cancelled",
                    Status = write.RefundStatus,
                    write.UserId,
                },
                tx,
                cancellationToken: cancellationToken));
        }

        await tx.CommitAsync(cancellationToken);
        return true;
    }

    public async Task RecordRefundAsync(
        string intentId,
        string stripeRefundId,
        decimal amount,
        string status,
        CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var paymentId = await connection.ExecuteScalarAsync<Guid?>(new CommandDefinition(
            "SELECT Id FROM Payments WHERE StripePaymentIntentId = @IntentId",
            new { IntentId = intentId },
            cancellationToken: cancellationToken));
        if (paymentId is null)
        {
            return;
        }

        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO Refunds
                    (Id, PaymentId, StripeRefundId, Amount, Reason, Status, ProcessedAt, CreatedAt)
                VALUES
                    (@Id, @PaymentId, @StripeRefundId, @Amount, 'Slot released before payment finished', @Status,
                     CASE WHEN @Status = 'succeeded' THEN UTC_TIMESTAMP(6) ELSE NULL END,
                     UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = Guid.NewGuid(),
                    PaymentId = paymentId,
                    StripeRefundId = stripeRefundId,
                    Amount = amount,
                    Status = status,
                },
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return;
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Payments
            SET Status = 'refunded', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND Status <> 'refunded'
            """,
            new { Id = paymentId },
            cancellationToken: cancellationToken));
    }

    public static (int Points, decimal Value, decimal Cash, string? Error) Quote(int requested, int balance, int rate, decimal price)
    {
        if (requested < 0)
        {
            return (0, 0, price, "Enter a points amount of zero or more.");
        }

        if (rate < 1)
        {
            rate = 100;
        }

        var points = Math.Min(requested, Math.Max(balance, 0));
        var maxPoints = price <= 0 ? 0 : (int)Math.Floor(price * rate);
        if (points > maxPoints)
        {
            points = maxPoints;
        }

        var cents = (int)Math.Floor(points * 100m / rate);
        var value = cents / 100m;
        if (value <= 0)
        {
            points = 0;
            value = 0;
        }

        if (value > price)
        {
            value = price;
        }

        var cash = decimal.Round(price - value, 2, MidpointRounding.AwayFromZero);
        if (cash > 0 && cash < 0.50m)
        {
            return (0, 0, price, "Use enough points to cover the booking, or leave at least $0.50 to pay.");
        }

        return (points, value, cash, null);
    }

    private static async Task<(Guid? Id, decimal Discount, string? Error)> LockPromotionAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        Guid userId,
        decimal price,
        string? code,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return (null, 0, null);
        }

        var promo = await connection.QuerySingleOrDefaultAsync<PromoLockRow>(new CommandDefinition(
            """
            SELECT Id, DiscountType, DiscountValue, MaxUses, UsedCount, MaxUsesPerUser
            FROM PromotionCodes
            WHERE Code = @Code AND IsActive = 1
              AND ValidFrom <= UTC_TIMESTAMP(6) AND ValidTo > UTC_TIMESTAMP(6)
              AND (VenueId IS NULL OR VenueId = @VenueId)
            FOR UPDATE
            """,
            new { Code = code.Trim().ToUpperInvariant(), VenueId = venueId },
            tx,
            cancellationToken: cancellationToken));
        if (promo is null)
        {
            return (null, 0, "That promotion code is not valid.");
        }

        if (promo.MaxUses is not null && promo.UsedCount >= promo.MaxUses)
        {
            return (null, 0, "That promotion code has been used up.");
        }

        var usedByUser = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*)
            FROM PromotionRedemptions
            WHERE PromotionCodeId = @Id AND UserId = @UserId
            """,
            new { promo.Id, UserId = userId },
            tx,
            cancellationToken: cancellationToken));
        if (usedByUser >= promo.MaxUsesPerUser)
        {
            return (null, 0, "You have already used that promotion code.");
        }

        var discount = promo.DiscountType == "percent"
            ? decimal.Round(price * promo.DiscountValue / 100m, 2, MidpointRounding.AwayFromZero)
            : promo.DiscountValue;
        if (discount > price)
        {
            discount = price;
        }

        return discount <= 0 ? (null, 0, "That promotion code is not valid.") : (promo.Id, discount, null);
    }

    private static async Task ExpireBookingAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid bookingId,
        Guid userId,
        int pointsToRestore,
        string paymentStatus,
        string? failureCode,
        string? failureMessage,
        CancellationToken cancellationToken)
    {
        var expired = await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Bookings
            SET Status = 'expired', UpdatedAt = UTC_TIMESTAMP(6)
            WHERE Id = @Id AND Status = 'pending'
            """,
            new { Id = bookingId },
            tx,
            cancellationToken: cancellationToken));
        if (expired != 1)
        {
            return;
        }

        if (pointsToRestore > 0)
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Users
                SET RewardPoints = RewardPoints + @Points, UpdatedAt = UTC_TIMESTAMP(6)
                WHERE Id = @UserId
                """,
                new { UserId = userId, Points = pointsToRestore },
                tx,
                cancellationToken: cancellationToken));
            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE RewardPointRedemptions
                SET PointsRestored = Points
                WHERE BookingId = @Id
                """,
                new { Id = bookingId },
                tx,
                cancellationToken: cancellationToken));
        }

        await connection.ExecuteAsync(new CommandDefinition(
            """
            UPDATE Payments
            SET Status = @Status, FailureCode = @Code, FailureMessage = @Message, UpdatedAt = UTC_TIMESTAMP(6)
            WHERE BookingId = @Id AND Status = 'pending'
            """,
            new { Id = bookingId, Status = paymentStatus, Code = Trim(failureCode, 100), Message = Trim(failureMessage, 500) },
            tx,
            cancellationToken: cancellationToken));
    }

    private static string? Trim(string? value, int max)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }

    private async Task<MySqlConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException("The MySQL connection string is not configured.");
        }

        var builder = new MySqlConnectionStringBuilder(connectionString) { GuidFormat = MySqlGuidFormat.Char36 };
        var connection = new MySqlConnection(builder.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }
}

public sealed class ExpiredHoldRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public int PointsToRestore { get; init; }
    public string? StripePaymentIntentId { get; init; }
}

public sealed class CheckoutPrepared
{
    public string? Error { get; init; }
    public int StatusCode { get; init; }
    public Guid BookingId { get; init; }
    public string Status { get; init; } = "";
    public string? ExistingIntentId { get; init; }
    public bool NeedsPayment { get; init; }
    public decimal Subtotal { get; init; }
    public int Points { get; init; }
    public decimal PointsValue { get; init; }
    public decimal Cash { get; init; }
    public decimal Discount { get; init; }
    public string Currency { get; init; } = "AUD";
    public string Email { get; init; } = "";
    public string? StripeCustomerId { get; init; }
    public Guid UserId { get; init; }
    public Guid VenueId { get; init; }
    public Guid SessionId { get; init; }

    public static CheckoutPrepared Fail(string error, int statusCode) => new() { Error = error, StatusCode = statusCode };
}

sealed class CheckoutSlotRow
{
    public Guid Id { get; init; }
    public Guid CourtId { get; init; }
    public decimal Price { get; init; }
    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public string Currency { get; init; } = "AUD";
    public int PointsPerDollar { get; init; }
    public bool CourtActive { get; init; }
    public bool CourtDeleted { get; init; }
}

sealed class PromoLockRow
{
    public Guid Id { get; init; }
    public string DiscountType { get; init; } = "";
    public decimal DiscountValue { get; init; }
    public int? MaxUses { get; init; }
    public int UsedCount { get; init; }
    public int MaxUsesPerUser { get; init; }
}

sealed class CheckoutUserRow
{
    public string Email { get; init; } = "";
    public int RewardPoints { get; init; }
    public string? StripeCustomerId { get; init; }
}

sealed class ActiveBookingRow
{
    public Guid Id { get; init; }
    public Guid UserId { get; init; }
    public string Status { get; init; } = "";
    public decimal SubtotalAmount { get; init; }
    public decimal TotalAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public decimal PointsValue { get; init; }
    public string? StripePaymentIntentId { get; init; }
}

sealed class PaymentStateRow
{
    public Guid BookingId { get; init; }
    public string Status { get; init; } = "";
    public Guid UserId { get; init; }
    public Guid VenueId { get; init; }
    public Guid SessionId { get; init; }
    public Guid PaymentId { get; init; }
    public string PaymentStatus { get; init; } = "";
    public decimal Amount { get; init; }
}

public sealed record PaymentTransition(
    string Action,
    Guid BookingId,
    Guid UserId,
    Guid VenueId,
    Guid SessionId,
    decimal Amount,
    string PaymentStatus);

public sealed class BookingPaymentRow
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public decimal TotalAmount { get; init; }
    public int PointsRedeemed { get; init; }
    public decimal PointsValue { get; init; }
    public string Currency { get; init; } = "AUD";
    public string? PaymentStatus { get; init; }
    public string? StripePaymentIntentId { get; init; }
}

public sealed class CancelContext
{
    public Guid Id { get; init; }
    public string Status { get; init; } = "";
    public Guid UserId { get; init; }
    public Guid VenueId { get; init; }
    public Guid SessionId { get; init; }
    public DateTime StartTime { get; init; }
    public string Currency { get; init; } = "AUD";
    public decimal LateCancelFeePercent { get; init; }
    public int PointsRedeemed { get; init; }
    public int PointsRestored { get; init; }
    public Guid? PaymentId { get; init; }
    public string? StripePaymentIntentId { get; init; }
    public string? PaymentStatus { get; init; }
    public decimal PaymentAmount { get; init; }
}

public sealed record CancelWrite(
    Guid Id,
    Guid UserId,
    decimal FeePercent,
    int PointsToRestore,
    Guid? PaymentId,
    string? PaymentStatus,
    string? StripeRefundId,
    decimal RefundAmount,
    string RefundStatus);
