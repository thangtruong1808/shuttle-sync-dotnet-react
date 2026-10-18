import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ShieldCheck, X } from "lucide-react";
import { Button, PickerInput, Spinner } from "../../components/ui";
import { Money } from "../../components/format";
import { AuthRequestError } from "../auth/authApi";
import { ConfirmTimeDialog } from "./ConfirmTimeDialog";
import { applyWeekChange, moveCourtSessions, refreshUnpaidHolds, weekOpenTimes, WeekChangeError, type CourtWeekCourt, type WeekSlot } from "./profileApi";

type PricePrompt = {
  code: "PRICE_INCREASE" | "PRICE_DECREASE";
  paid: number;
  quote: number;
  difference: number;
  refundAmount: number;
};

function venueClock(iso: string, timeZone: string) {
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

function bookedMinutes(start: string, end: string) {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  const stepped = Math.round(minutes / 30) * 30;
  return Math.min(1440, Math.max(30, stepped || 60));
}

function lengthLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${hours} hr ${rest} min`;
}

function clockMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function requestMessage(reason: unknown, fallback: string) {
  return reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? fallback : fallback;
}

export function ChangeHours({
  courts,
  scope,
  disabled,
  onBusy,
  onSaved,
  onClose,
}: {
  courts: CourtWeekCourt[];
  scope: "week" | "court";
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const first = courts[0];
  const opened = venueClock(first.startTime, first.timeZone);
  const closed = venueClock(first.endTime, first.timeZone);
  const duration = bookedMinutes(first.startTime, first.endTime);
  const [date, setDate] = useState(opened.date);
  const [start, setStart] = useState(opened.time);
  const [end, setEnd] = useState(closed.time);
  const [times, setTimes] = useState<WeekSlot[] | null>(null);
  const [heldTimes, setHeldTimes] = useState<WeekSlot[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState<PricePrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || saving;
  const week = scope === "week";
  const title = week ? "Change hours for this week" : `Change hours for ${first.courtName}`;
  const courtKey = courts.map((court) => court.courtId).join(",");

  useEffect(() => {
    let live = true;
    setLoadingTimes(true);
    weekOpenTimes(first.groupId, first.startTime, date, courtKey.split(",").filter(Boolean), duration)
      .then((result) => {
        if (!live) return;
        setTimes(result.times.filter((slot) => !(slot.date === opened.date && slot.start === opened.time && slot.end === closed.time)));
        setHeldTimes(result.heldForRecurring);
      })
      .catch(() => {
        if (live) {
          setTimes([]);
          setHeldTimes([]);
          setError("Open times could not be loaded. You can still type a start and an end.");
        }
      })
      .finally(() => {
        if (live) setLoadingTimes(false);
      });
    return () => {
      live = false;
    };
  }, [closed.time, courtKey, date, duration, first.groupId, first.startTime, opened.date, opened.time]);

  function pick(slot: WeekSlot) {
    setDate(slot.date);
    setStart(slot.start);
    setEnd(slot.end);
    setError(null);
    setPrompt(null);
    setReviewing(false);
  }

  function review() {
    const startMinute = clockMinutes(start);
    const endMinute = clockMinutes(end);
    if (!date || startMinute === null || endMinute === null) {
      setError("Choose a date, a start, and an end.");
      return;
    }
    if (endMinute <= startMinute) {
      setError("The end time must be later than the start time.");
      return;
    }
    if (endMinute - startMinute < 30) {
      setError("Choose at least 30 minutes.");
      return;
    }
    if (date === opened.date && start === opened.time && end === closed.time) {
      setError("That is already the time for this booking.");
      return;
    }
    setError(null);
    setPrompt(null);
    setReviewing(true);
  }

  async function save(acceptPriceIncrease = false, acceptRefund = false) {
    setSaving(true);
    onBusy(true);
    setError(null);
    try {
      if (week) {
        const saved = await applyWeekChange(first.groupId, {
          startTime: first.startTime,
          date,
          start,
          end,
          courtIds: courts.map((court) => court.courtId),
          acceptPriceIncrease,
          acceptRefund,
          changeHours: true,
        });
        setPrompt(null);
        setReviewing(false);
        const payIds = saved.payNow ? saved.payBookingIds : saved.addedBookingIds;
        if ((saved.payNow || saved.topUpAmount > 0) && payIds.length > 0) {
          refreshUnpaidHolds();
          navigate(`/${first.venueSlug}/book/group/${first.groupId}?bookings=${payIds.join(",")}`);
          return;
        }
        const pendingOnly = courts.every((court) => court.status !== "confirmed");
        onSaved(saved.refundAmount > 0 ? "These hours changed. The difference is being refunded to your card." : pendingOnly ? "These hours changed. The hold price is updated." : "These hours changed.");
        return;
      }

      const saved = await moveCourtSessions(first.groupId, {
        startTime: first.startTime,
        bookingId: first.bookingId,
        date,
        start,
        end,
        acceptPriceIncrease,
        acceptRefund,
        changeHours: true,
      });
      if (saved.code === "PRICE_INCREASE" || saved.code === "PRICE_DECREASE") {
        setReviewing(false);
        setPrompt({
          code: saved.code,
          paid: saved.paid,
          quote: saved.quote,
          difference: saved.difference,
          refundAmount: saved.refundAmount,
        });
        return;
      }
      setPrompt(null);
      if (saved.payBookingIds.length > 0) {
        refreshUnpaidHolds();
        navigate(`/${first.venueSlug}/book/group/${first.groupId}?bookings=${saved.payBookingIds.join(",")}`);
        return;
      }
      onSaved(first.status !== "confirmed" ? "These hours changed. The hold price is updated." : saved.refundAmount > 0 ? "These hours changed. The difference is being refunded to your card." : "These hours changed.");
    } catch (reason) {
      setReviewing(false);
      if (reason instanceof WeekChangeError && (reason.code === "PRICE_INCREASE" || reason.code === "PRICE_DECREASE")) {
        setPrompt({
          code: reason.code,
          paid: reason.paid,
          quote: reason.quote,
          difference: reason.facts.difference ?? 0,
          refundAmount: reason.facts.difference ?? 0,
        });
        return;
      }
      setError(reason instanceof WeekChangeError ? reason.fallback : requestMessage(reason, "That time is not available."));
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }

  function slotButton(slot: WeekSlot, held: boolean) {
    const picked = date === slot.date && start === slot.start && end === slot.end;
    return (
      <Button key={`${held ? "held" : "open"}-${slot.date}-${slot.start}`} type="button" variant="secondary" aria-pressed={picked} className={`w-full ${picked ? "border-line bg-line/15 text-white" : ""}`} disabled={busy} onClick={() => pick(slot)}>
        {slot.label}
      </Button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-line/30 bg-line/5 p-3">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-xs text-mist/70">
        {week ? "Every court in this week uses the new start and end. Later weeks stay where they are." : "Only this court changes. Later weeks stay where they are."} Currently {lengthLabel(duration)}, {opened.time}–{closed.time}. Recommended times use that length. Nothing is saved until you confirm.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-sm text-mist">
          <span className="mb-1 block">Date</span>
          <PickerInput type="date" required value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setError(null); setPrompt(null); setReviewing(false); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block">Start</span>
          <PickerInput type="time" required value={start} disabled={busy} onChange={(event) => { setStart(event.target.value); setError(null); setPrompt(null); setReviewing(false); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block">End</span>
          <PickerInput type="time" required value={end} disabled={busy} onChange={(event) => { setEnd(event.target.value); setError(null); setPrompt(null); setReviewing(false); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
      </div>
      <p className="mt-3 text-xs text-mist/70">Recommended times for {lengthLabel(duration)}. Picking one fills Start and End.</p>
      {loadingTimes || times === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-mist" aria-busy="true"><Spinner className="h-4 w-4" /> Loading recommended times</p>
      ) : times.length === 0 ? (
        <p className="mt-3 text-sm text-mist" role="status">No recommended time of {lengthLabel(duration)} is free on this date. You can still type a start and an end.</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="list">
          {times.map((slot) => slotButton(slot, false))}
        </div>
      )}
      {heldTimes.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm text-mist">These times are held for a later week. Choosing one fills Start and End, and confirming leaves this booking where it is.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {heldTimes.map((slot) => slotButton(slot, true))}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100" role="alert">{error}</p> : null}
      {prompt ? (
        <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-400/10 p-3" role="status">
          <p className="text-sm font-semibold text-white">{prompt.code === "PRICE_INCREASE" ? "This time costs more" : "This time costs less"}</p>
          <p className="mt-2 text-sm text-mist/80">
            The current price is <Money amount={prompt.paid} currency={first.currency} />. The new time is <Money amount={prompt.quote} currency={first.currency} />.
            {prompt.code === "PRICE_INCREASE" ? <> Pay <Money amount={prompt.difference} currency={first.currency} /> more to confirm. The hours stay as they are until that payment is finished. A start within 24 hours must be paid now.</> : prompt.refundAmount > 0 ? <> Refund <Money amount={prompt.refundAmount} currency={first.currency} /> to your card?</> : <> No card refund is due. Change the hours anyway?</>}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {prompt.code === "PRICE_INCREASE" ? (
              <Button type="button" className="w-full sm:w-auto" loading={saving} disabled={busy && !saving} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => void save(true, false)}>Pay the difference</Button>
            ) : (
              <Button type="button" className="w-full sm:w-auto" loading={saving} disabled={busy && !saving} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => void save(false, true)}>{prompt.refundAmount > 0 ? "Yes, refund and change" : "Yes, change the hours"}</Button>
            )}
            <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={() => setPrompt(null)}>No, keep this time</Button>
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="w-full sm:w-auto" disabled={busy} icon={<Clock className="h-4 w-4" aria-hidden="true" />} onClick={review}>Review these hours</Button>
        <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={busy} icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={onClose}>Keep current hours</Button>
      </div>
      {reviewing && !prompt ? (
        <ConfirmTimeDialog
          title={week ? "Change this week's hours?" : `Change hours for ${first.courtName}?`}
          detail={week ? `Every court in this week will use ${date}, ${start} to ${end}. Later weeks stay where they are. Nothing changes until you confirm.` : `${first.courtName} will use ${date}, ${start} to ${end}. Nothing changes until you confirm.`}
          error={error}
          loading={saving}
          onConfirm={() => void save()}
          onCancel={() => { if (!saving) setReviewing(false); }}
        />
      ) : null}
    </div>
  );
}
