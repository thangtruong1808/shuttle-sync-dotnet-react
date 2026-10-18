using System.Globalization;
using System.Text.Json;
using Dapper;
using MySqlConnector;
using ShuttleSync.Api.Booking;

namespace ShuttleSync.Api.Data;

public sealed partial class BookingRepository
{
    public async Task<WeekCourtAvailability?> WeekAvailabilityAsync(Guid userId, Guid groupId, DateTime startUtc, CancellationToken cancellationToken)
    {
        var board = await LoadWeekBoardAsync(userId, groupId, startUtc, null, cancellationToken);
        if (board is null)
        {
            return null;
        }

        var courts = board.Courts.Select(court =>
        {
            var yours = board.Week.Any(row => row.CourtId == court.Id);
            var free = !yours && CourtState(board, court.Id, board.WeekStart, board.WeekEnd, board.WeekIds) == WeekCourtState.Free;
            return new WeekCourtChoice(court.Id, court.CourtName, yours, free);
        }).ToArray();
        return new WeekCourtAvailability(courts.All(court => !court.Free), courts);
    }

    public async Task<WeekOpenTimes?> OpenTimesAsync(
        Guid userId,
        Guid groupId,
        DateTime currentStart,
        string? date,
        IReadOnlyCollection<Guid> courtIds,
        int? durationMinutes,
        CancellationToken cancellationToken)
    {
        var board = await LoadWeekBoardAsync(userId, groupId, currentStart, date, cancellationToken);
        if (board is null)
        {
            return null;
        }

        var wanted = courtIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        if (wanted.Length == 0)
        {
            wanted = board.Week.Select(row => row.CourtId).Distinct().ToArray();
        }

        var duration = board.WeekEnd - board.WeekStart;
        if (durationMinutes is >= 30 and <= 24 * 60 && durationMinutes.Value % 30 == 0)
        {
            duration = TimeSpan.FromMinutes(durationMinutes.Value);
        }

        if (duration < TimeSpan.FromMinutes(30))
        {
            return new WeekOpenTimes([], []);
        }

        var day = string.IsNullOrWhiteSpace(date) ? board.Date : date;
        var times = new List<WeekSlotFact>();
        var held = new List<WeekSlotFact>();
        for (var minute = 6 * 60; minute + (int)duration.TotalMinutes <= 24 * 60; minute += 30)
        {
            var startClock = $"{minute / 60:00}:{minute % 60:00}";
            var endMinute = minute + (int)duration.TotalMinutes;
            var endClock = endMinute == 24 * 60 ? "23:59" : $"{endMinute / 60:00}:{endMinute % 60:00}";
            if (!VenueClock.TryGetDayWindow(board.TimeZone, day, startClock, endMinute == 24 * 60 ? "23:59" : endClock, out var window, out _))
            {
                continue;
            }

            if (endMinute == 24 * 60 || window.StartUtc <= DateTime.UtcNow)
            {
                continue;
            }

            var states = wanted.Select(id => CourtState(board, id, window.StartUtc, window.EndUtc, board.WeekIds)).ToArray();
            if (states.Any(state => state == WeekCourtState.Unknown))
            {
                continue;
            }

            var slot = new WeekSlotFact(window.Date, startClock, endClock, SlotLabel(board.TimeZone, window.StartUtc, window.EndUtc));
            if (states.All(state => state == WeekCourtState.Free))
            {
                times.Add(slot);
            }
            else if (states.All(state => state is WeekCourtState.Free or WeekCourtState.OwnRepeat) && states.Any(state => state == WeekCourtState.OwnRepeat))
            {
                held.Add(slot);
            }

            if (times.Count >= 24 && held.Count >= 8)
            {
                break;
            }
        }

        return new WeekOpenTimes(times.Take(24).ToArray(), held.Take(8).ToArray());
    }

    public async Task<WeekChangeResult> ApplyWeekAsync(
        Guid userId,
        Guid groupId,
        DateTime currentStart,
        string? date,
        string? start,
        string? end,
        IReadOnlyCollection<Guid> courtIds,
        bool acceptPriceIncrease,
        string? ip,
        CancellationToken cancellationToken,
        bool changeHours = false,
        bool acceptRefund = false)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var rows = (await connection.QueryAsync<WeekEditRow>(new CommandDefinition(
            """
            SELECT b.Id, b.GroupId, b.CourtSessionId, b.Status, b.VenueId, c.Id AS CourtId, c.CourtName,
                   v.TimeZone, v.HourlyRate, v.Slug, cs.StartTime, cs.EndTime, cs.Price AS SessionPrice,
                   b.SubtotalAmount, b.TotalAmount,
                   b.DiscountAmount, b.PointsRedeemed, b.PointsValue,
                   CAST(COALESCE(b.SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.IsDeleted = 0
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.GroupId = @GroupId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
              AND ABS(TIMESTAMPDIFF(SECOND, cs.StartTime, @CurrentStart)) < 2
            """,
            new { UserId = userId, GroupId = groupId, CurrentStart = currentStart },
            cancellationToken: cancellationToken))).ToArray();
        if (rows.Length == 0)
        {
            return Fail("COURT_UNAVAILABLE", ["That week"], "this week", []);
        }

        var sample = rows[0];
        if (!VenueClock.TryGetDayWindow(sample.TimeZone, date, start, end, out var window, out var clockError))
        {
            return Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), clockError, []);
        }

        if (window.EndUtc <= window.StartUtc || window.EndUtc - window.StartUtc < TimeSpan.FromMinutes(30))
        {
            var tooShort = Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), SlotLabel(sample.TimeZone, window.StartUtc, window.EndUtc), []);
            return new WeekChangeResult { Ok = false, Code = tooShort.Code, Fallback = "Choose at least 30 minutes.", Facts = tooShort.Facts };
        }

        if (window.StartUtc <= DateTime.UtcNow)
        {
            var started = Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), SlotLabel(sample.TimeZone, window.StartUtc, window.EndUtc), []);
            return new WeekChangeResult { Ok = false, Code = started.Code, Fallback = "Choose a time that has not started.", Facts = started.Facts };
        }

        var wanted = courtIds.Where(id => id != Guid.Empty).Distinct().ToArray();
        var currentIds = rows.Select(row => row.CourtId).ToHashSet();
        if (wanted.Length == 0 || currentIds.Any(id => !wanted.Contains(id)))
        {
            return Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), SlotLabel(sample.TimeZone, window.StartUtc, window.EndUtc), []);
        }

        var addedIds = wanted.Where(id => !currentIds.Contains(id)).ToArray();
        var sameTime = rows.All(row => SameInstant(row.StartTime, window.StartUtc) && SameInstant(row.EndTime, window.EndUtc));
        var when = SlotLabel(sample.TimeZone, window.StartUtc, window.EndUtc);
        var alternatives = await AlternativeSlotsAsync(userId, groupId, currentStart, window.Date, wanted, cancellationToken);
        if (sameTime && addedIds.Length == 0)
        {
            return new WeekChangeResult { Ok = true, Facts = WeekChangeText.Facts("", rows.Select(row => row.CourtName), when, alternatives, null) };
        }

        var rateWindows = await LoadRateWindowsAsync(connection, sample.VenueId, null, cancellationToken);
        var price = CourtRates.Quote(sample.TimeZone, sample.HourlyRate, window.StartUtc, window.EndUtc, rateWindows);
        if (price <= 0)
        {
            return Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), when, alternatives);
        }

        var confirmedRows = rows.Where(row => row.Status == "confirmed").ToArray();
        decimal Gap(WeekEditRow row) => decimal.Round(price - (changeHours ? row.SubtotalAmount : Covered(row)), 2, MidpointRounding.AwayFromZero);
        var increase = confirmedRows.Sum(row => Math.Max(0, Gap(row)));
        var quotedIncrease = decimal.Round(increase, 2, MidpointRounding.AwayFromZero);
        var paidNow = decimal.Round(confirmedRows.Sum(row => changeHours ? row.SubtotalAmount : Covered(row)), 2, MidpointRounding.AwayFromZero);
        var quoted = decimal.Round(price * Math.Max(confirmedRows.Length, 1), 2, MidpointRounding.AwayFromZero);
        if (changeHours && confirmedRows.Any(row => Gap(row) > 0.009m) && confirmedRows.Any(row => Gap(row) < -0.009m))
        {
            return new WeekChangeResult
            {
                Ok = false,
                Code = "COURT_UNAVAILABLE",
                Fallback = "These courts do not share one price change. Change hours on one court at a time.",
                Facts = WeekChangeText.Facts("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), when, alternatives, null),
            };
        }

        if (!sameTime && increase > 0.009m && !acceptPriceIncrease)
        {
            return WithMoney(Fail("PRICE_INCREASE", rows.Select(row => row.CourtName), when, alternatives, quotedIncrease), paidNow, quoted, quotedIncrease);
        }

        var decreaseRows = changeHours ? confirmedRows.Where(row => Gap(row) < -0.009m).ToArray() : [];
        var cashRefund = decimal.Round(decreaseRows.Sum(row => Math.Min(row.TotalAmount, row.SubtotalAmount - price)), 2, MidpointRounding.AwayFromZero);
        if (changeHours && !sameTime && decreaseRows.Length > 0 && increase <= 0.009m && !acceptRefund)
        {
            return WithMoney(Fail("PRICE_DECREASE", rows.Select(row => row.CourtName), when, alternatives, cashRefund), paidNow, quoted, cashRefund);
        }

        var repeatCourt = await connection.QueryFirstOrDefaultAsync<string>(new CommandDefinition(
            """
            SELECT c.CourtName
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.IsDeleted = 0
            JOIN Courts c ON c.Id = cs.CourtId
            WHERE b.UserId = @UserId AND b.GroupId = @GroupId AND b.IsDeleted = 0
              AND b.RepeatHold = 1 AND b.Status IN ('pending', 'confirmed')
              AND b.Id NOT IN @WeekIds
              AND cs.CourtId IN @CourtIds
              AND cs.StartTime < @EndTime AND cs.EndTime > @StartTime
            LIMIT 1
            """,
            new { UserId = userId, GroupId = groupId, WeekIds = rows.Select(row => row.Id).ToArray(), CourtIds = wanted, StartTime = window.StartUtc, EndTime = window.EndUtc },
            cancellationToken: cancellationToken));
        if (!string.IsNullOrWhiteSpace(repeatCourt))
        {
            return Fail("HELD_FOR_RECURRING", [repeatCourt], when, alternatives);
        }

        await using var tx = await connection.BeginTransactionAsync(cancellationToken);
        var social = await SocialBusyMessageAsync(connection, tx, sample.VenueId, sample.TimeZone, wanted, window.StartUtc, window.EndUtc, cancellationToken);
        if (social is not null)
        {
            return Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), when, alternatives);
        }

        var courts = (await connection.QueryAsync<HoldCourtRow>(new CommandDefinition(
            """
            SELECT Id, CourtName
            FROM Courts
            WHERE Id IN @Ids AND VenueId = @VenueId AND IsDeleted = 0 AND IsActive = 1
            ORDER BY Id
            FOR UPDATE
            """,
            new { Ids = wanted, VenueId = sample.VenueId },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        if (courts.Length != wanted.Length)
        {
            return Fail("COURT_UNAVAILABLE", rows.Select(row => row.CourtName), when, alternatives);
        }

        var topUp = !sameTime && increase > 0.009m;
        var hourRefunds = new List<CourtRefundDue>();
        if (!sameTime && !topUp)
        {
            var moved = await MoveWeekRowsAsync(connection, tx, rows, window.StartUtc, window.EndUtc, price, userId, cancellationToken);
            if (moved.Code is not null)
            {
                return Fail(moved.Code, [moved.Court], when, alternatives, increase > 0 ? increase : null);
            }

            if (changeHours)
            {
                foreach (var row in decreaseRows)
                {
                    var drop = decimal.Round(row.SubtotalAmount - price, 2, MidpointRounding.AwayFromZero);
                    var cash = decimal.Round(Math.Min(row.TotalAmount, Math.Max(0, drop)), 2, MidpointRounding.AwayFromZero);
                    await connection.ExecuteAsync(new CommandDefinition(
                        """
                        UPDATE Bookings
                        SET SubtotalAmount = @Price,
                            TotalAmount = GREATEST(0, TotalAmount - @Cash),
                            UpdatedAt = UTC_TIMESTAMP(6)
                        WHERE Id = @Id AND Status = 'confirmed'
                        """,
                        new { Id = row.Id, Price = price, Cash = cash },
                        tx,
                        cancellationToken: cancellationToken));
                    if (cash > 0.009m)
                    {
                        hourRefunds.Add(new CourtRefundDue
                        {
                            BookingId = row.Id,
                            Amount = cash,
                            Key = $"hours-refund-{row.Id:N}-{window.StartUtc:yyyyMMddHHmmss}-{(int)decimal.Round(cash * 100m, 0)}",
                            Snapshot = new CourtMoveSnapshot
                            {
                                BookingId = row.Id,
                                SessionId = row.CourtSessionId,
                                StartTime = row.StartTime,
                                EndTime = row.EndTime,
                                SessionPrice = row.SessionPrice,
                                SubtotalAmount = row.SubtotalAmount,
                                TotalAmount = row.TotalAmount,
                            },
                        });
                    }
                }
            }
        }

        var charged = rows.Where(row => row.Status == "confirmed" && price - row.SubtotalAmount > 0.009m).ToArray();
        var extendHours = changeHours && topUp && charged.Length > 0 && charged.All(row => SameInstant(row.StartTime, window.StartUtc) && window.EndUtc > row.EndTime);
        var marker = topUp ? "week-topup|" + DateTime.SpecifyKind(currentStart, DateTimeKind.Utc).ToString("o") + (extendHours ? "|extend" : "") : null;
        if (topUp)
        {
            if (changeHours)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE CourtSessions cs
                    JOIN Bookings b ON b.CourtSessionId = cs.Id
                    SET cs.IsDeleted = 1, cs.UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE b.GroupId = @GroupId AND b.UserId = @UserId AND b.IsDeleted = 0 AND b.Status = 'pending'
                      AND b.CancelReason LIKE 'week-topup|%'
                    """,
                    new { GroupId = sample.GroupId, UserId = userId },
                    tx,
                    cancellationToken: cancellationToken));
            }

            await connection.ExecuteAsync(new CommandDefinition(
                """
                UPDATE Bookings
                SET Status = 'expired', HoldExpiresAt = NULL, CancelReason = 'Replaced', UpdatedAt = UTC_TIMESTAMP(6)
                WHERE GroupId = @GroupId AND UserId = @UserId AND IsDeleted = 0 AND Status = 'pending'
                  AND CancelReason LIKE 'week-topup|%'
                """,
                new { GroupId = sample.GroupId, UserId = userId },
                tx,
                cancellationToken: cancellationToken));
        }

        var addedBookings = new List<Guid>();
        var due = 0m;
        if (topUp)
        {
            if (changeHours)
            {
                var pendingRows = rows.Where(row => row.Status != "confirmed").ToArray();
                if (pendingRows.Length > 0)
                {
                    var pendingMove = await MoveWeekRowsAsync(connection, tx, pendingRows, window.StartUtc, window.EndUtc, price, userId, cancellationToken);
                    if (pendingMove.Code is not null)
                    {
                        return Fail(pendingMove.Code, [pendingMove.Court], when, alternatives);
                    }
                }
            }

            foreach (var row in rows)
            {
                if (changeHours && row.Status != "confirmed")
                {
                    continue;
                }

                var court = courts.First(item => item.Id == row.CourtId);
                var charge = row.Status == "confirmed"
                    ? Math.Max(0, price - (changeHours ? row.SubtotalAmount : Covered(row)))
                    : price;
                if (changeHours && charge <= 0.009m)
                {
                    var even = await MoveWeekRowsAsync(connection, tx, [row], window.StartUtc, window.EndUtc, price, userId, cancellationToken);
                    if (even.Code is not null)
                    {
                        return Fail(even.Code, [even.Court], when, alternatives);
                    }

                    continue;
                }

                due += charge;
                var holdUntil = changeHours && window.StartUtc <= DateTime.UtcNow.AddHours(24) ? DateTime.UtcNow.AddMinutes(30) : (DateTime?)null;
                var created = extendHours
                    ? await InsertExtensionSliceAsync(
                        connection,
                        tx,
                        new MoveSessionRow
                        {
                            Id = row.Id,
                            GroupId = row.GroupId,
                            CourtSessionId = row.CourtSessionId,
                            Status = row.Status,
                            VenueId = row.VenueId,
                            CourtId = row.CourtId,
                            CourtName = row.CourtName,
                            TimeZone = row.TimeZone,
                            HourlyRate = row.HourlyRate,
                            StartTime = row.StartTime,
                            EndTime = row.EndTime,
                            SessionPrice = row.SessionPrice,
                            SubtotalAmount = row.SubtotalAmount,
                            TotalAmount = row.TotalAmount,
                            DiscountAmount = row.DiscountAmount,
                            PointsRedeemed = row.PointsRedeemed,
                            PointsValue = row.PointsValue,
                            SeriesWeeks = row.SeriesWeeks,
                            RepeatHold = row.RepeatHold,
                        },
                        row.EndTime,
                        window.EndUtc,
                        price,
                        charge,
                        userId,
                        marker ?? "",
                        cancellationToken,
                        holdUntil)
                    : await InsertWeekCourtAsync(connection, tx, sample, court, window.StartUtc, window.EndUtc, price, userId, cancellationToken, charge, marker, 0, changeHours ? [row.CourtSessionId] : null, holdUntil);
                if (created.Error is not null)
                {
                    return Fail(created.Error, [court.CourtName], when, alternatives);
                }

                if (created.BookingId is Guid bookingId)
                {
                    addedBookings.Add(bookingId);
                }
            }
        }

        foreach (var court in courts.Where(court => addedIds.Contains(court.Id)))
        {
            if (topUp) due += price;
            var created = await InsertWeekCourtAsync(connection, tx, sample, court, window.StartUtc, window.EndUtc, price, userId, cancellationToken, topUp ? price : null, marker, topUp ? 0 : null);
            if (created.Error is not null)
            {
                return Fail(created.Error, [court.CourtName], when, alternatives);
            }

            if (created.BookingId is Guid bookingId)
            {
                addedBookings.Add(bookingId);
            }
        }

        if (!sameTime && !topUp)
        {
            await AuditWeekAsync(
                connection,
                tx,
                userId,
                sample.VenueId,
                groupId,
                changeHours ? "booking.hours_changed" : "booking.week_rescheduled",
                new { rows = rows.Select(row => new { row.CourtId, row.CourtName, row.StartTime, row.EndTime, row.SubtotalAmount, row.TotalAmount }) },
                new { start = window.StartUtc, end = window.EndUtc, price, refunds = hourRefunds.Select(refund => new { refund.BookingId, refund.Amount }) },
                ip,
                cancellationToken);
        }

        if (addedIds.Length > 0 && !topUp)
        {
            await AuditWeekAsync(connection, tx, userId, sample.VenueId, groupId, "booking.week_courts_added", new { courts = rows.Select(row => row.CourtId) }, new { added = addedIds, start = window.StartUtc, end = window.EndUtc, price }, ip, cancellationToken);
        }

        await tx.CommitAsync(cancellationToken);
        var withinDay = window.StartUtc <= DateTime.UtcNow.AddHours(24);
        var payIds = !withinDay
            ? []
            : addedBookings.Count > 0
                ? addedBookings.ToArray()
                : rows.Where(row => row.Status == "pending").Select(row => row.Id).ToArray();
        return new WeekChangeResult
        {
            Ok = true,
            TopUpAmount = topUp ? decimal.Round(due, 2, MidpointRounding.AwayFromZero) : 0,
            AddedBookingIds = addedBookings.ToArray(),
            PayNow = payIds.Length > 0,
            PayBookingIds = payIds,
            Paid = paidNow,
            Quote = quoted,
            Refunds = hourRefunds.ToArray(),
            Facts = WeekChangeText.Facts("", courts.Select(court => court.CourtName), when, alternatives, null),
        };
    }

    private static WeekChangeResult WithMoney(WeekChangeResult result, decimal paid, decimal quote, decimal difference) =>
        new()
        {
            Ok = result.Ok,
            Code = result.Code,
            Fallback = result.Fallback,
            Facts = result.Facts,
            Paid = paid,
            Quote = quote,
            Difference = difference,
        };

    private async Task<WeekSlotFact[]> AlternativeSlotsAsync(Guid userId, Guid groupId, DateTime currentStart, string date, Guid[] courtIds, CancellationToken cancellationToken)
    {
        var open = await OpenTimesAsync(userId, groupId, currentStart, date, courtIds, null, cancellationToken);
        return open?.Times.Take(3).ToArray() ?? [];
    }

    private async Task<WeekRowMove> MoveWeekRowsAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        WeekEditRow[] rows,
        DateTime startUtc,
        DateTime endUtc,
        decimal price,
        Guid userId,
        CancellationToken cancellationToken)
    {
        var keep = rows.Select(row => row.CourtSessionId).ToArray();
        foreach (var row in rows)
        {
            var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                SELECT COUNT(*) FROM CourtClosures
                WHERE VenueId = @VenueId AND (CourtId = @CourtId OR CourtId IS NULL)
                  AND StartTime < @EndTime AND EndTime > @StartTime
                """,
                new { VenueId = row.VenueId, CourtId = row.CourtId, StartTime = startUtc, EndTime = endUtc },
                tx,
                cancellationToken: cancellationToken));
            if (closed > 0)
            {
                return WeekRowMove.Block("COURT_UNAVAILABLE", row.CourtName);
            }

            var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
                """
                SELECT Id, StartTime, EndTime
                FROM CourtSessions
                WHERE CourtId = @CourtId AND IsDeleted = 0 AND Id NOT IN @Keep
                  AND StartTime < @EndTime AND EndTime > @StartTime
                FOR UPDATE
                """,
                new { CourtId = row.CourtId, Keep = keep, StartTime = startUtc, EndTime = endUtc },
                tx,
                cancellationToken: cancellationToken))).ToArray();
            var busy = await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken);
            if (busy is not null)
            {
                return WeekRowMove.Block(busy.UserId == userId ? "HELD_FOR_RECURRING" : "SLOT_TAKEN", row.CourtName);
            }

            var stale = overlaps.FirstOrDefault(item => SameInstant(item.StartTime, startUtc));
            try
            {
                if (stale is not null)
                {
                    await connection.ExecuteAsync(new CommandDefinition(
                        "UPDATE CourtSessions SET EndTime = @EndTime, Price = @Price, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                        new { Id = stale.Id, EndTime = endUtc, Price = price },
                        tx,
                        cancellationToken: cancellationToken));
                    await connection.ExecuteAsync(new CommandDefinition(
                        "UPDATE Bookings SET CourtSessionId = @Target, UpdatedAt = UTC_TIMESTAMP(6) WHERE Id = @Id",
                        new { Id = row.Id, Target = stale.Id },
                        tx,
                        cancellationToken: cancellationToken));
                }
                else
                {
                    await connection.ExecuteAsync(new CommandDefinition(
                        """
                        UPDATE CourtSessions
                        SET StartTime = @StartTime, EndTime = @EndTime, Price = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                        WHERE Id = @Id AND IsDeleted = 0
                        """,
                        new { Id = row.CourtSessionId, StartTime = startUtc, EndTime = endUtc, Price = price },
                        tx,
                        cancellationToken: cancellationToken));
                }
            }
            catch (MySqlException exception) when (exception.Number == 1062)
            {
                return WeekRowMove.Block("SLOT_TAKEN", row.CourtName);
            }

            if (row.Status == "pending" && row.DiscountAmount == 0 && row.PointsRedeemed == 0)
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE Bookings
                    SET SubtotalAmount = @Price, TotalAmount = @Price, UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND Status = 'pending'
                    """,
                    new { Id = row.Id, Price = price },
                    tx,
                    cancellationToken: cancellationToken));
            }

            if (row.Status == "pending" && startUtc <= DateTime.UtcNow.AddHours(24))
            {
                await connection.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE Bookings
                    SET HoldExpiresAt = @Hold, UpdatedAt = UTC_TIMESTAMP(6)
                    WHERE Id = @Id AND Status = 'pending'
                    """,
                    new { Id = row.Id, Hold = DateTime.UtcNow.AddMinutes(30) },
                    tx,
                    cancellationToken: cancellationToken));
            }
        }

        return WeekRowMove.Clear;
    }

    private async Task<(Guid? BookingId, string? Error)> InsertWeekCourtAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        WeekEditRow sample,
        HoldCourtRow court,
        DateTime startUtc,
        DateTime endUtc,
        decimal price,
        Guid userId,
        CancellationToken cancellationToken,
        decimal? charge = null,
        string? cancelReason = null,
        int? repeatHold = null,
        IReadOnlyCollection<Guid>? ignoreSessionIds = null,
        DateTime? holdExpiresAt = null)
    {
        var closed = await connection.ExecuteScalarAsync<int>(new CommandDefinition(
            """
            SELECT COUNT(*) FROM CourtClosures
            WHERE VenueId = @VenueId AND (CourtId = @CourtId OR CourtId IS NULL)
              AND StartTime < @EndTime AND EndTime > @StartTime
            """,
            new { VenueId = sample.VenueId, CourtId = court.Id, StartTime = startUtc, EndTime = endUtc },
            tx,
            cancellationToken: cancellationToken));
        if (closed > 0)
        {
            return (null, "COURT_UNAVAILABLE");
        }

        var ignore = ignoreSessionIds?.Where(id => id != Guid.Empty).Distinct().ToArray() ?? [];
        var overlaps = (await connection.QueryAsync<OverlapSessionRow>(new CommandDefinition(
            ignore.Length == 0
                ? """
                  SELECT Id, StartTime, EndTime
                  FROM CourtSessions
                  WHERE CourtId = @CourtId AND IsDeleted = 0
                    AND StartTime < @EndTime AND EndTime > @StartTime
                  FOR UPDATE
                  """
                : """
                  SELECT Id, StartTime, EndTime
                  FROM CourtSessions
                  WHERE CourtId = @CourtId AND IsDeleted = 0
                    AND Id NOT IN @Ignore
                    AND StartTime < @EndTime AND EndTime > @StartTime
                  FOR UPDATE
                  """,
            new { CourtId = court.Id, StartTime = startUtc, EndTime = endUtc, Ignore = ignore },
            tx,
            cancellationToken: cancellationToken))).ToArray();
        var busy = await ActiveOverlapAsync(connection, tx, overlaps, cancellationToken);
        if (busy is not null)
        {
            return (null, busy.UserId == userId ? "HELD_FOR_RECURRING" : "SLOT_TAKEN");
        }

        Guid sessionId;
        try
        {
            sessionId = overlaps.Length == 0
                ? await InsertSessionAsync(connection, tx, sample.VenueId, court.Id, startUtc, endUtc, price, cancellationToken)
                : await ReuseOrInsertSessionAsync(connection, tx, overlaps, sample.VenueId, court.Id, startUtc, endUtc, price, cancellationToken);
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return (null, "SLOT_TAKEN");
        }

        var bookingId = Guid.NewGuid();
        var hold = holdExpiresAt ?? (startUtc > DateTime.UtcNow.AddHours(24) ? startUtc.AddHours(-24) : DateTime.UtcNow.AddMinutes(30));
        try
        {
            await connection.ExecuteAsync(new CommandDefinition(
                """
                INSERT INTO Bookings
                    (Id, VenueId, UserId, CourtSessionId, GroupId, SeriesWeeks, RepeatHold, Status, SubtotalAmount, DiscountAmount, TotalAmount,
                     PointsRedeemed, PointsValue, HoldExpiresAt, CancelReason, IsDeleted, CreatedAt, UpdatedAt)
                VALUES
                    (@Id, @VenueId, @UserId, @SessionId, @GroupId, @SeriesWeeks, @RepeatHold, 'pending', @Charge, 0, @Charge,
                     0, 0, @Hold, @CancelReason, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
                """,
                new
                {
                    Id = bookingId,
                    VenueId = sample.VenueId,
                    UserId = userId,
                    SessionId = sessionId,
                    GroupId = sample.GroupId,
                    SeriesWeeks = sample.SeriesWeeks > 0 ? sample.SeriesWeeks : (int?)null,
                    RepeatHold = repeatHold ?? sample.RepeatHold,
                    Charge = decimal.Round(charge ?? price, 2, MidpointRounding.AwayFromZero),
                    Hold = hold,
                    CancelReason = cancelReason,
                },
                tx,
                cancellationToken: cancellationToken));
        }
        catch (MySqlException exception) when (exception.Number == 1062)
        {
            return (null, "SLOT_TAKEN");
        }

        return (bookingId, null);
    }

    private async Task<(Guid? BookingId, string? Error)> InsertExtensionSliceAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        MoveSessionRow row,
        DateTime sliceStart,
        DateTime sliceEnd,
        decimal fullPrice,
        decimal charge,
        Guid userId,
        string marker,
        CancellationToken cancellationToken,
        DateTime? holdExpiresAt = null)
    {
        var sample = new WeekEditRow
        {
            Id = row.Id,
            GroupId = row.GroupId,
            CourtSessionId = row.CourtSessionId,
            Status = row.Status,
            VenueId = row.VenueId,
            CourtId = row.CourtId,
            CourtName = row.CourtName,
            TimeZone = row.TimeZone,
            HourlyRate = row.HourlyRate,
            StartTime = row.StartTime,
            EndTime = row.EndTime,
            TotalAmount = row.TotalAmount,
            DiscountAmount = row.DiscountAmount,
            PointsRedeemed = row.PointsRedeemed,
            PointsValue = row.PointsValue,
            SeriesWeeks = row.SeriesWeeks,
            RepeatHold = row.RepeatHold,
        };
        return await InsertWeekCourtAsync(
            connection,
            tx,
            sample,
            new HoldCourtRow { Id = row.CourtId, CourtName = row.CourtName },
            sliceStart,
            sliceEnd,
            fullPrice,
            userId,
            cancellationToken,
            charge,
            marker,
            0,
            null,
            holdExpiresAt);
    }

    private static async Task<Guid> InsertSessionAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid venueId,
        Guid courtId,
        DateTime startUtc,
        DateTime endUtc,
        decimal price,
        CancellationToken cancellationToken)
    {
        var id = Guid.NewGuid();
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO CourtSessions
                (Id, VenueId, CourtId, StartTime, EndTime, Price, IsDeleted, CreatedAt, UpdatedAt)
            VALUES
                (@Id, @VenueId, @CourtId, @StartTime, @EndTime, @Price, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
            """,
            new { Id = id, VenueId = venueId, CourtId = courtId, StartTime = startUtc, EndTime = endUtc, Price = price },
            tx,
            cancellationToken: cancellationToken));
        return id;
    }

    private static async Task AuditWeekAsync(
        MySqlConnection connection,
        MySqlTransaction tx,
        Guid userId,
        Guid venueId,
        Guid groupId,
        string action,
        object oldValues,
        object newValues,
        string? ip,
        CancellationToken cancellationToken)
    {
        await connection.ExecuteAsync(new CommandDefinition(
            """
            INSERT INTO AuditLogs (Id, UserId, VenueId, Action, Entity, EntityId, OldValues, NewValues, IpAddress, CreatedAt)
            VALUES (@Id, @UserId, @VenueId, @Action, 'Booking', @EntityId, @OldValues, @NewValues, @IpAddress, UTC_TIMESTAMP(6))
            """,
            new
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                VenueId = venueId,
                Action = action,
                EntityId = groupId,
                OldValues = JsonSerializer.Serialize(oldValues),
                NewValues = JsonSerializer.Serialize(newValues),
                IpAddress = ip,
            },
            tx,
            cancellationToken: cancellationToken));
    }

    private async Task<WeekBoard?> LoadWeekBoardAsync(Guid userId, Guid groupId, DateTime startUtc, string? date, CancellationToken cancellationToken)
    {
        await using var connection = await OpenAsync(cancellationToken);
        var week = (await connection.QueryAsync<WeekEditRow>(new CommandDefinition(
            """
            SELECT b.Id, b.GroupId, b.CourtSessionId, b.Status, b.VenueId, c.Id AS CourtId, c.CourtName,
                   v.TimeZone, v.HourlyRate, v.Slug, cs.StartTime, cs.EndTime, b.TotalAmount,
                   b.DiscountAmount, b.PointsRedeemed, b.PointsValue,
                   CAST(COALESCE(b.SeriesWeeks, 0) AS SIGNED) AS SeriesWeeks,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold
            FROM Bookings b
            JOIN CourtSessions cs ON cs.Id = b.CourtSessionId AND cs.IsDeleted = 0
            JOIN Courts c ON c.Id = cs.CourtId
            JOIN Venues v ON v.Id = b.VenueId
            WHERE b.UserId = @UserId AND b.GroupId = @GroupId AND b.IsDeleted = 0
              AND b.Status IN ('pending', 'confirmed')
              AND ABS(TIMESTAMPDIFF(SECOND, cs.StartTime, @Start)) < 2
            """,
            new { UserId = userId, GroupId = groupId, Start = startUtc },
            cancellationToken: cancellationToken))).ToArray();
        if (week.Length == 0)
        {
            return null;
        }

        var sample = week[0];
        if (!VenueClock.TryGetDayWindow(sample.TimeZone, null, "00:00", "23:59", out var today, out _))
        {
            return null;
        }

        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(sample.StartTime, DateTimeKind.Utc), TimeZoneInfo.FindSystemTimeZoneById(sample.TimeZone));
        var boardDate = string.IsNullOrWhiteSpace(date) ? local.ToString("yyyy-MM-dd") : date;
        if (!VenueClock.TryGetDayWindow(sample.TimeZone, boardDate, "00:00", "23:59", out var day, out _))
        {
            day = today;
        }

        var courts = (await connection.QueryAsync<HoldCourtRow>(new CommandDefinition(
            "SELECT Id, CourtName FROM Courts WHERE VenueId = @VenueId AND IsDeleted = 0 AND IsActive = 1 ORDER BY CourtName",
            new { VenueId = sample.VenueId },
            cancellationToken: cancellationToken))).ToArray();
        var busy = (await connection.QueryAsync<WeekBusyRow>(new CommandDefinition(
            """
            SELECT cs.CourtId, cs.StartTime, cs.EndTime, b.Id AS BookingId, b.UserId, b.GroupId,
                   CAST(b.RepeatHold AS SIGNED) AS RepeatHold
            FROM CourtSessions cs
            JOIN Bookings b ON b.CourtSessionId = cs.Id AND b.IsDeleted = 0
            WHERE cs.VenueId = @VenueId AND cs.IsDeleted = 0
              AND cs.StartTime < @EndTime AND cs.EndTime > @StartTime
              AND b.Status NOT IN ('cancelled', 'expired')
              AND NOT (b.Status = 'pending' AND b.HoldExpiresAt IS NOT NULL AND b.HoldExpiresAt <= UTC_TIMESTAMP(6))
            """,
            new { VenueId = sample.VenueId, StartTime = day.StartUtc, EndTime = day.EndUtc },
            cancellationToken: cancellationToken))).ToArray();
        var closures = (await connection.QueryAsync<ClosureRow>(new CommandDefinition(
            """
            SELECT CourtId, StartTime, EndTime
            FROM CourtClosures
            WHERE VenueId = @VenueId AND StartTime < @EndTime AND EndTime > @StartTime
            """,
            new { VenueId = sample.VenueId, StartTime = day.StartUtc, EndTime = day.EndUtc },
            cancellationToken: cancellationToken))).ToArray();
        return new WeekBoard(sample.TimeZone, sample.VenueId, userId, groupId, sample.StartTime, sample.EndTime, day.Date, week, courts, busy, closures);
    }

    private static WeekCourtState CourtState(WeekBoard board, Guid courtId, DateTime startUtc, DateTime endUtc, HashSet<Guid> weekIds)
    {
        if (!board.Courts.Any(court => court.Id == courtId))
        {
            return WeekCourtState.Unknown;
        }

        if (board.Closures.Any(row => (row.CourtId is null || row.CourtId == courtId) && row.StartTime < endUtc && row.EndTime > startUtc))
        {
            return WeekCourtState.Taken;
        }

        var hits = board.Busy.Where(row => row.CourtId == courtId && row.StartTime < endUtc && row.EndTime > startUtc && !weekIds.Contains(row.BookingId)).ToArray();
        if (hits.Any(row => row.UserId != board.UserId || row.GroupId != board.GroupId || row.RepeatHold != 1))
        {
            return WeekCourtState.Taken;
        }

        return hits.Length > 0 ? WeekCourtState.OwnRepeat : WeekCourtState.Free;
    }

    private readonly record struct WeekRowMove(string? Code, string Court)
    {
        public static WeekRowMove Clear { get; } = new(null, "");

        public static WeekRowMove Block(string code, string court) => new(code, court);
    }

    private static decimal Covered(WeekEditRow row) => row.TotalAmount + row.PointsValue + row.DiscountAmount;

    private static WeekChangeResult Fail(string code, IEnumerable<string> courts, string when, IEnumerable<WeekSlotFact> alternatives, decimal? difference = null)
    {
        var facts = WeekChangeText.Facts(code, courts, when, alternatives, difference);
        return new WeekChangeResult { Ok = false, Code = code, Fallback = WeekChangeText.Template(facts), Facts = facts };
    }

    private static string SlotLabel(string timeZone, DateTime startUtc, DateTime endUtc)
    {
        var zone = TimeZoneInfo.FindSystemTimeZoneById(timeZone);
        var start = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(startUtc, DateTimeKind.Utc), zone);
        var end = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(endUtc, DateTimeKind.Utc), zone);
        var culture = CultureInfo.GetCultureInfo("en-AU");
        return $"{start.ToString("d MMM", culture)}, {start.ToString("h:mm tt", culture)} – {end.ToString("h:mm tt", culture)}";
    }

    private sealed class WeekEditRow
    {
        public Guid Id { get; init; }
        public Guid GroupId { get; init; }
        public Guid CourtSessionId { get; init; }
        public string Status { get; init; } = "";
        public Guid VenueId { get; init; }
        public Guid CourtId { get; init; }
        public string CourtName { get; init; } = "";
        public string TimeZone { get; init; } = "";
        public string Slug { get; init; } = "";
        public decimal HourlyRate { get; init; }
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
        public decimal SessionPrice { get; init; }
        public decimal SubtotalAmount { get; init; }
        public decimal TotalAmount { get; init; }
        public decimal DiscountAmount { get; init; }
        public int PointsRedeemed { get; init; }
        public decimal PointsValue { get; init; }
        public int SeriesWeeks { get; init; }
        public int RepeatHold { get; init; }
    }

    private sealed class WeekBusyRow
    {
        public Guid CourtId { get; init; }
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
        public Guid BookingId { get; init; }
        public Guid UserId { get; init; }
        public Guid? GroupId { get; init; }
        public int RepeatHold { get; init; }
    }

    private sealed class ClosureRow
    {
        public Guid? CourtId { get; init; }
        public DateTime StartTime { get; init; }
        public DateTime EndTime { get; init; }
    }

    private sealed class WeekBoard(
        string timeZone,
        Guid venueId,
        Guid userId,
        Guid groupId,
        DateTime weekStart,
        DateTime weekEnd,
        string date,
        WeekEditRow[] week,
        HoldCourtRow[] courts,
        WeekBusyRow[] busy,
        ClosureRow[] closures)
    {
        public string TimeZone { get; } = timeZone;
        public Guid VenueId { get; } = venueId;
        public Guid UserId { get; } = userId;
        public Guid GroupId { get; } = groupId;
        public DateTime WeekStart { get; } = weekStart;
        public DateTime WeekEnd { get; } = weekEnd;
        public string Date { get; } = date;
        public WeekEditRow[] Week { get; } = week;
        public HashSet<Guid> WeekIds { get; } = week.Select(row => row.Id).ToHashSet();
        public HoldCourtRow[] Courts { get; } = courts;
        public WeekBusyRow[] Busy { get; } = busy;
        public ClosureRow[] Closures { get; } = closures;
    }

    private enum WeekCourtState { Free, Taken, OwnRepeat, Unknown }
}

public sealed record WeekCourtChoice(Guid Id, string CourtName, bool Yours, bool Free);

public sealed record WeekCourtAvailability(bool AllCourtsBooked, WeekCourtChoice[] Courts);

public sealed record WeekOpenTimes(WeekSlotFact[] Times, WeekSlotFact[] HeldForRecurring);
