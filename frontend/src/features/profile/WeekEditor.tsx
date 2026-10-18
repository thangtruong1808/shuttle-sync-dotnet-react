import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, CalendarDays, ChevronDown, CircleAlert, CircleCheck, Clock, CreditCard, TriangleAlert, Undo2 } from "lucide-react";
import { Button, PickerInput, Spinner } from "../../components/ui";
import { Money, formatVenueRange } from "../../components/format";
import { AuthRequestError } from "../auth/authApi";
import { applyWeekChange, cancelBooking, deleteUnpaidHold, refreshUnpaidHolds, setCourtRepeat, weekAvailability, weekOpenTimes, WeekChangeError, type CourtWeekCourt, type WeekFacts, type WeekSlot } from "./profileApi";
import { ConfirmTimeDialog } from "./ConfirmTimeDialog";
import { ChangeHours } from "./ChangeHours";
import { CourtReschedule } from "./CourtReschedule";
import { WeekReason } from "./WeekReason";

function venueFields(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const hour = part("hour") === "24" ? "00" : part("hour").padStart(2, "0");
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${hour}:${part("minute").padStart(2, "0")}` };
}

function requestMessage(reason: unknown, fallback: string) {
  return reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? fallback : fallback;
}

function formatWeekDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function WeekTimes({
  slots,
  loading,
  held,
  empty,
  busy,
  selected,
  onPick,
}: {
  slots: WeekSlot[];
  loading: boolean;
  held: boolean;
  empty: string;
  busy: boolean;
  selected: WeekSlot | null;
  onPick: (slot: WeekSlot) => void;
}) {
  if (loading) {
    return <p className="mt-3 flex items-center gap-2 text-sm text-mist" aria-busy="true"><Spinner className="h-4 w-4" /> Loading open times</p>;
  }
  if (slots.length === 0) {
    return <p className="mt-3 text-sm text-mist" role="status">{held ? "That time is held for a later week because you keep weeks ahead. Choose another date, or cancel that held week and book again." : empty}</p>;
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2" role="list">
      {slots.map((slot) => {
        const picked = selected?.date === slot.date && selected.start === slot.start;
        return (
          <Button key={`${slot.date}-${slot.start}`} type="button" variant="secondary" aria-pressed={picked} className={`w-full ${picked ? "border-line bg-line/15 text-white" : ""}`} disabled={busy} onClick={() => onPick(slot)}>
            {slot.label}
          </Button>
        );
      })}
    </div>
  );
}

export function WeekEditor({ courts, pendingTopUp = [], onChanged }: { courts: CourtWeekCourt[]; pendingTopUp?: CourtWeekCourt[]; onChanged: () => void }) {
  const navigate = useNavigate();
  const first = courts[0];
  const reasonId = useId();
  const [checked, setChecked] = useState(() => new Set(courts.map((court) => court.courtId)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<{ fallback: string; facts: WeekFacts } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const openedAt = venueFields(first.startTime, first.timeZone);
  const closedAt = venueFields(first.endTime, first.timeZone);
  const weekOriginal = { date: openedAt.date, start: openedAt.time, end: closedAt.time };
  const [rescheduling, setRescheduling] = useState(false);
  const [moveDate, setMoveDate] = useState(openedAt.date);
  const [times, setTimes] = useState<WeekSlot[] | null>(null);
  const [heldSlot, setHeldSlot] = useState(false);
  const [heldTimes, setHeldTimes] = useState<WeekSlot[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [moving, setMoving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [pendingMove, setPendingMove] = useState<WeekSlot | null>(null);
  const [chosenTime, setChosenTime] = useState<WeekSlot | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [courtMoving, setCourtMoving] = useState(false);
  const [changingHours, setChangingHours] = useState(false);
  const [hourBookingId, setHourBookingId] = useState<string | null>(null);
  const [hourBusy, setHourBusy] = useState(false);
  const [availability, setAvailability] = useState<"loading" | "open" | "full">("loading");
  const locked = saving || moving || deleting || accepting || courtMoving || hourBusy;
  const sessionCourt = sessionId ? courts.find((court) => court.bookingId === sessionId) ?? null : null;
  const hourCourt = hourBookingId ? courts.find((court) => court.bookingId === hourBookingId) ?? null : null;
  const removed = courts.filter((court) => !checked.has(court.courtId));
  const selected = courts.filter((court) => checked.has(court.courtId));
  const total = selected.reduce((sum, court) => sum + court.price, 0);
  const dirty = removed.length > 0;
  const pending = selected.filter((court) => court.status === "pending");
  const currentTotal = courts.reduce((sum, court) => sum + court.price, 0);
  const removedPaid = removed.filter((court) => court.status === "confirmed");
  const addParams = new URLSearchParams({
    groupId: first.groupId,
    start: first.startTime,
    date: openedAt.date,
    courts: courts.map((court) => court.courtId).join(","),
  });

  useEffect(() => {
    let live = true;
    weekAvailability(first.groupId, first.startTime)
      .then((result) => {
        if (live) setAvailability(result.allCourtsBooked ? "full" : "open");
      })
      .catch(() => {
        if (live) setAvailability("open");
      });
    return () => {
      live = false;
    };
  }, [first.groupId, first.startTime]);

  useEffect(() => {
    if (!rescheduling) return;
    let live = true;
    setLoadingTimes(true);
    weekOpenTimes(first.groupId, first.startTime, moveDate, courts.map((court) => court.courtId))
      .then((result) => {
        if (!live) return;
        setTimes(result.times.filter((slot) => !(slot.date === weekOriginal.date && slot.start === weekOriginal.start)));
        setHeldTimes(result.heldForRecurring);
        setHeldSlot(result.heldForRecurring.length > 0 && result.times.length === 0);
      })
      .catch(() => {
        if (live) {
          setTimes([]);
          setHeldTimes([]);
          setError("Open times could not be loaded.");
        }
      })
      .finally(() => {
        if (live) setLoadingTimes(false);
      });
    return () => {
      live = false;
    };
  }, [rescheduling, moveDate, first.groupId, first.startTime, courts.map((court) => court.courtId).join(","), weekOriginal.date, weekOriginal.start]);

  function undoChanges() {
    setChecked(new Set(courts.map((court) => court.courtId)));
    setConfirmPaid(false);
    setError(null);
  }

  async function save() {
    if (removed.some((court) => court.status === "confirmed") && !confirmPaid) {
      setConfirmPaid(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const court of removed) {
        await cancelBooking(court.bookingId);
      }
      setConfirmPaid(false);
      refreshUnpaidHolds();
      onChanged();
    } catch (reason) {
      setError(requestMessage(reason, "This week could not be updated."));
    } finally {
      setSaving(false);
    }
  }

  async function moveWeek(slot: WeekSlot, acceptPriceIncrease = false) {
    if (acceptPriceIncrease) setAccepting(true);
    else setMoving(true);
    setError(null);
    setBlock(null);
    try {
      const saved = await applyWeekChange(first.groupId, {
        startTime: first.startTime,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        courtIds: courts.map((court) => court.courtId),
        acceptPriceIncrease,
      });
      setRescheduling(false);
      setPendingMove(null);
      setChosenTime(null);
      const payIds = saved.payNow ? saved.payBookingIds : saved.addedBookingIds;
      if ((saved.payNow || saved.topUpAmount > 0) && payIds.length > 0) {
        navigate(`/${first.venueSlug}/book/group/${first.groupId}?bookings=${payIds.join(",")}`);
        return;
      }
      setNotice("This week moved.");
      refreshUnpaidHolds();
      onChanged();
    } catch (reason) {
      if (reason instanceof WeekChangeError) {
        setPendingMove(slot);
        setBlock({ fallback: reason.fallback, facts: reason.facts });
      } else {
        setError("That date and time is not available.");
      }
    } finally {
      setMoving(false);
      setAccepting(false);
    }
  }

  async function removeWeek() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const unpaid = courts.filter((court) => court.status === "pending");
      const paid = courts.filter((court) => court.status === "confirmed");
      if (unpaid.length > 0) await deleteUnpaidHold(first.groupId, unpaid.map((court) => court.bookingId));
      else if (first.repeatHold) await setCourtRepeat(first.groupId, false);
      for (const court of paid) await cancelBooking(court.bookingId);
      refreshUnpaidHolds();
      onChanged();
    } catch (reason) {
      setError(requestMessage(reason, "This week could not be deleted."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl bg-black/20 p-3">
      <p className="text-sm text-mist/75">This week is <span className="font-semibold text-white"><Money amount={total} currency={first.currency} /></span> for the courts left ticked.</p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {courts.map((court) => (
          <li key={court.bookingId}>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-mist">
              <input
                type="checkbox"
                className="h-4 w-4 accent-line"
                checked={checked.has(court.courtId)}
                disabled={locked || rescheduling || sessionCourt !== null || changingHours || hourCourt !== null}
                onChange={() => {
                  setConfirmPaid(false);
                  setChecked((current) => {
                    const next = new Set(current);
                    if (next.has(court.courtId)) next.delete(court.courtId);
                    else next.add(court.courtId);
                    return next;
                  });
                }}
              />
              <span className={`min-w-0 ${!checked.has(court.courtId) ? "text-mist/50 line-through" : ""}`}>
                <span className="block">{court.courtName}</span>
                <span className="block text-xs text-mist/60">{formatVenueRange(court.startTime, court.endTime, court.timeZone)}</span>
              </span>
              <span className="ml-auto text-xs text-mist/60">{court.status === "confirmed" ? "Paid" : "Held"}</span>
            </label>
            <div className="mt-1 flex flex-wrap gap-3">
              <button
                type="button"
                aria-expanded={sessionId === court.bookingId}
                className="inline-flex items-center gap-1 text-xs font-semibold text-line hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                disabled={locked || dirty}
                onClick={() => {
                  setRescheduling(false);
                  setChangingHours(false);
                  setHourBookingId(null);
                  setSessionId((current) => current === court.bookingId ? null : court.bookingId);
                  setError(null);
                  setBlock(null);
                }}
              >
                <CalendarClock className="h-3 w-3" aria-hidden="true" />
                Reschedule
                <ChevronDown className={`h-3 w-3 transition-transform ${sessionId === court.bookingId ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-expanded={hourBookingId === court.bookingId}
                className="inline-flex items-center gap-1 text-xs font-semibold text-line hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                disabled={locked || dirty}
                onClick={() => {
                  setRescheduling(false);
                  setChangingHours(false);
                  setSessionId(null);
                  setHourBookingId((current) => current === court.bookingId ? null : court.bookingId);
                  setError(null);
                  setBlock(null);
                }}
              >
                <Clock className="h-3 w-3" aria-hidden="true" />
                Change hours
                <ChevronDown className={`h-3 w-3 transition-transform ${hourBookingId === court.bookingId ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {dirty ? (
        <div className={`mt-3 rounded-xl border p-3 ${confirmPaid ? "border-amber-300/50 bg-amber-400/10" : "border-line/30 bg-line/5"}`} role="status">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            {confirmPaid ? <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" /> : <CircleAlert className="h-4 w-4 shrink-0 text-line" aria-hidden="true" />}
            {confirmPaid ? "Please confirm before we cancel paid courts" : "You have unsaved changes for this week"}
          </p>
          <p className="mt-2 text-sm text-mist/80">
            Weekly total: <span className="text-mist/60 line-through"><Money amount={currentTotal} currency={first.currency} /></span>{" "}
            <span className="font-semibold text-white"><Money amount={total} currency={first.currency} /></span>
          </p>
          {removedPaid.length > 0 ? <p className="mt-2 text-xs text-mist/80">{removedPaid.length} paid {removedPaid.length === 1 ? "court is" : "courts are"} cancelled under the cancellation policy.</p> : null}
        </div>
      ) : null}
      {notice ? <p className="mt-3 rounded-xl border border-line/40 bg-line/10 px-3 py-2 text-sm text-line" role="status">{notice}</p> : null}
      {confirmDelete ? <p className="mt-2 text-sm text-mist" role="status">Delete this week? Unpaid courts are released. A paid court is cancelled under the cancellation policy.</p> : null}
      {error ? <p className="mt-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100" role="alert">{error}</p> : null}
      {block ? <WeekReason facts={block.facts} fallback={block.fallback} /> : null}
      {block?.facts.code === "PRICE_INCREASE" && pendingMove ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="w-full sm:w-auto" loading={accepting} disabled={locked && !accepting} onClick={() => void moveWeek(pendingMove, true)}>Accept the difference and move</Button>
          <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={locked} onClick={() => { setBlock(null); setPendingMove(null); }}>Keep this time</Button>
        </div>
      ) : null}
      {hourCourt ? (
        <ChangeHours
          courts={[hourCourt]}
          scope="court"
          disabled={saving || moving || deleting || accepting}
          onBusy={setHourBusy}
          onSaved={(message) => { setNotice(message); setHourBookingId(null); refreshUnpaidHolds(); onChanged(); }}
          onClose={() => setHourBookingId(null)}
        />
      ) : sessionCourt ? (
        <CourtReschedule
          court={sessionCourt}
          disabled={saving || moving || deleting || accepting}
          onBusy={setCourtMoving}
          onSaved={(message) => { setNotice(message); setSessionId(null); refreshUnpaidHolds(); onChanged(); }}
          onClose={() => setSessionId(null)}
        />
      ) : changingHours ? (
        <ChangeHours
          courts={courts}
          scope="week"
          disabled={saving || moving || deleting || accepting}
          onBusy={setHourBusy}
          onSaved={(message) => { setNotice(message); setChangingHours(false); refreshUnpaidHolds(); onChanged(); }}
          onClose={() => setChangingHours(false)}
        />
      ) : rescheduling ? (
        <div className="mt-3 rounded-xl border border-line/30 bg-line/5 p-3">
          <p className="text-sm font-semibold text-white">Reschedule this week</p>
          <p className="mt-1 text-xs text-mist/70">Every court in this week moves together. Currently {formatWeekDate(first.startTime, first.timeZone)} · {formatVenueRange(first.startTime, first.endTime, first.timeZone)}</p>
          <label className="mt-3 block text-sm text-mist">
            <span className="mb-1 block text-mist/70">Date</span>
            <PickerInput type="date" required value={moveDate} disabled={locked} onChange={(event) => { setMoveDate(event.target.value); setBlock(null); setChosenTime(null); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
          </label>
          <p className="mt-3 text-xs text-mist/70">Pick a time, then confirm. Nothing moves until you confirm.</p>
          <WeekTimes slots={times ?? []} loading={loadingTimes || times === null} held={heldSlot} empty="No open time on this date fits every court in this week." busy={locked} selected={chosenTime} onPick={(slot) => { setChosenTime(slot); setBlock(null); setError(null); }} />
          {heldTimes.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm text-mist">These times are held for a later week. Choosing one keeps this week where it is.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {heldTimes.map((slot) => {
                  const picked = chosenTime?.date === slot.date && chosenTime.start === slot.start;
                  return (
                    <Button key={`held-${slot.date}-${slot.start}`} type="button" variant="secondary" aria-pressed={picked} className={`w-full ${picked ? "border-line bg-line/15 text-white" : ""}`} disabled={locked} onClick={() => { setChosenTime(slot); setBlock(null); setError(null); }}>{slot.label}</Button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <Button type="button" variant="secondary" className="mt-3 w-full sm:w-auto" disabled={locked} onClick={() => { setRescheduling(false); setBlock(null); setChosenTime(null); }}>Keep current time</Button>
          {chosenTime && !block ? (
            <ConfirmTimeDialog
              title="Move this week?"
              detail={heldTimes.some((slot) => slot.date === chosenTime.date && slot.start === chosenTime.start) ? `${chosenTime.label} is held for a later week. Confirming leaves this week where it is.` : `Every court in this week will move to ${chosenTime.label}. Nothing changes until you confirm.`}
              error={error}
              loading={moving}
              onConfirm={() => void moveWeek(chosenTime)}
              onCancel={() => { setChosenTime(null); setError(null); }}
            />
          ) : null}
        </div>
      ) : null}
      {hourCourt || sessionCourt ? null : (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-mist/80"><span className="font-medium text-white">Need a different day or time?</span></p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              aria-expanded={rescheduling}
              className={`w-full sm:w-auto ${rescheduling ? "border-line bg-line/15 text-white" : ""}`}
              disabled={locked || dirty}
              icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setChangingHours(false);
                setHourBookingId(null);
                setSessionId(null);
                setError(null);
                setBlock(null);
                setChosenTime(null);
                setRescheduling((open) => !open);
              }}
            >
              Reschedule this week
              <ChevronDown className={`h-4 w-4 transition-transform ${rescheduling ? "rotate-180" : ""}`} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-expanded={changingHours}
              className={`w-full sm:w-auto ${changingHours ? "border-line bg-line/15 text-white" : ""}`}
              disabled={locked || dirty}
              icon={<Clock className="h-4 w-4" aria-hidden="true" />}
              onClick={() => {
                setRescheduling(false);
                setHourBookingId(null);
                setSessionId(null);
                setError(null);
                setBlock(null);
                setChangingHours((open) => !open);
              }}
            >
              Change hours for this week
              <ChevronDown className={`h-4 w-4 transition-transform ${changingHours ? "rotate-180" : ""}`} aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="danger" className="w-full sm:w-auto" loading={deleting} disabled={locked && !deleting} onClick={() => void removeWeek()}>{confirmDelete ? "Confirm delete" : "Delete this week"}</Button>
        {availability === "full" ? (
          <button type="button" aria-disabled="true" aria-describedby={reasonId} className="inline-flex w-full cursor-not-allowed items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-mist/70 sm:w-auto" onClick={(event) => event.preventDefault()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.preventDefault(); }}>
            Add another court
          </button>
        ) : availability === "loading" ? (
          <Button type="button" variant="secondary" className="w-full sm:w-auto" loading disabled>Add another court</Button>
        ) : (
          <Link to={`/${first.venueSlug}/book?${addParams}`} className="inline-flex w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-mist hover:bg-white/10 sm:w-auto">Add another court</Link>
        )}
        {pendingTopUp.length > 0 ? (
          <Link to={`/${first.venueSlug}/book/group/${first.groupId}?bookings=${pendingTopUp.map((court) => court.bookingId).join(",")}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pay the difference
          </Link>
        ) : null}
        {dirty ? (
          <>
            <Button type="button" className="w-full sm:w-auto" loading={saving} disabled={locked && !saving} icon={<CircleCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => void save()}>{confirmPaid ? "Confirm update" : "Update this week"}</Button>
            <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={locked} icon={<Undo2 className="h-4 w-4" aria-hidden="true" />} onClick={undoChanges}>Cancel changes</Button>
          </>
        ) : pending.length > 0 ? (
          <Link to={`/${first.venueSlug}/book/group/${first.groupId}?bookings=${pending.map((court) => court.bookingId).join(",")}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
            Pay this week
          </Link>
        ) : <p className="text-sm text-line">This week is paid.</p>}
      </div>
      {availability === "full" ? <p id={reasonId} className="mt-2 text-xs text-mist/70" role="tooltip">All courts are booked for this week. Use Reschedule this week to look at another time.</p> : null}
    </div>
  );
}
