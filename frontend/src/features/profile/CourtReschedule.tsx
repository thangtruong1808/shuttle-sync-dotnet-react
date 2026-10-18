import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, X } from "lucide-react";
import { Button, PickerInput, Spinner } from "../../components/ui";
import { Money } from "../../components/format";
import { AuthRequestError } from "../auth/authApi";
import { ConfirmTimeDialog } from "./ConfirmTimeDialog";
import { moveCourtSessions, weekOpenTimes, type CourtWeekCourt, type WeekSlot } from "./profileApi";

type PricePrompt = {
  code: "PRICE_INCREASE" | "PRICE_DECREASE";
  paid: number;
  quote: number;
  difference: number;
  refundAmount: number;
  slot: WeekSlot;
};

const lengths = [30, 60, 90, 120, 150, 180, 240];

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

function courtMinutes(start: string, end: string) {
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
  const stepped = Math.round(minutes / 30) * 30;
  return Math.min(240, Math.max(30, stepped || 60));
}

function lengthLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${hours} hr ${rest} min`;
}

function requestMessage(reason: unknown, fallback: string) {
  return reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? fallback : fallback;
}

export function CourtReschedule({
  court,
  disabled,
  onBusy,
  onSaved,
  onClose,
}: {
  court: CourtWeekCourt;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const opened = venueClock(court.startTime, court.timeZone).date;
  const currentStart = venueClock(court.startTime, court.timeZone).time;
  const currentEnd = venueClock(court.endTime, court.timeZone).time;
  const currentLength = courtMinutes(court.startTime, court.endTime);
  const [date, setDate] = useState(opened);
  const [duration, setDuration] = useState(currentLength);
  const [times, setTimes] = useState<WeekSlot[] | null>(null);
  const [heldTimes, setHeldTimes] = useState<WeekSlot[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(true);
  const [movingKey, setMovingKey] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [prompt, setPrompt] = useState<PricePrompt | null>(null);
  const [chosen, setChosen] = useState<WeekSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = disabled || movingKey !== null || accepting;
  const choices = [...new Set([...lengths, currentLength])].sort((left, right) => left - right);

  useEffect(() => {
    let live = true;
    setLoadingTimes(true);
    setPrompt(null);
    setChosen(null);
    weekOpenTimes(court.groupId, court.startTime, date, [court.courtId], duration)
      .then((result) => {
        if (!live) return;
        setTimes(result.times.filter((slot) => !(slot.date === opened && slot.start === currentStart && slot.end === currentEnd && duration === currentLength)));
        setHeldTimes(result.heldForRecurring);
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
  }, [court.courtId, court.groupId, court.startTime, currentEnd, currentLength, currentStart, date, duration, opened]);

  async function move(slot: WeekSlot, acceptPriceIncrease = false, acceptRefund = false) {
    if (acceptPriceIncrease || acceptRefund) setAccepting(true);
    else setMovingKey(`${slot.date}-${slot.start}`);
    onBusy(true);
    setError(null);
    try {
      const saved = await moveCourtSessions(court.groupId, {
        startTime: court.startTime,
        bookingId: court.bookingId,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        acceptPriceIncrease,
        acceptRefund,
      });
      if (saved.code === "PRICE_INCREASE" || saved.code === "PRICE_DECREASE") {
        setChosen(null);
        setPrompt({
          code: saved.code,
          paid: saved.paid,
          quote: saved.quote,
          difference: saved.difference,
          refundAmount: saved.refundAmount,
          slot,
        });
        return;
      }
      setPrompt(null);
      if (saved.payBookingIds.length > 0) {
        navigate(`/${court.venueSlug}/book/group/${court.groupId}?bookings=${saved.payBookingIds.join(",")}`);
        return;
      }
      onSaved(court.status === "confirmed" && saved.refundAmount > 0 ? "This court moved. The difference is being refunded to your card." : "This court moved.");
    } catch (reason) {
      setError(requestMessage(reason, "That date and time is not available."));
    } finally {
      setMovingKey(null);
      setAccepting(false);
      onBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line/30 bg-line/5 p-3">
      <p className="text-sm font-semibold text-white">Reschedule {court.courtName}</p>
      <p className="mt-1 text-xs text-mist/70">
        Only this court moves. Pick a time, then confirm. {court.status === "confirmed" ? <>You paid <Money amount={court.price} currency={court.currency} /> for {lengthLabel(currentLength)}. A longer time asks you to pay the difference. A shorter time asks before any refund.</> : "This hold is not paid yet, so the price updates to the new time."}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm text-mist">
          <span className="mb-1 block">New date</span>
          <PickerInput type="date" required value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setError(null); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block">Length</span>
          <select value={duration} disabled={busy} onChange={(event) => { setDuration(Number(event.target.value)); setError(null); }} className="w-full rounded-xl border border-white/15 bg-[#102117] px-3 py-2 text-white [color-scheme:dark] disabled:opacity-60">
            {choices.map((minutes) => <option key={minutes} value={minutes} className="bg-[#102117] text-white">{lengthLabel(minutes)}</option>)}
          </select>
        </label>
      </div>
      {loadingTimes || times === null ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-mist" aria-busy="true"><Spinner className="h-4 w-4" /> Loading open times</p>
      ) : times.length === 0 ? (
        <p className="mt-3 text-sm text-mist" role="status">{heldTimes.length > 0 ? "That time is held for a later week because you keep weeks ahead. Choose another date, or cancel that held week and book again." : "No open time on this date for this court and length."}</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" role="list">
          {times.map((slot) => {
            const key = `${slot.date}-${slot.start}`;
            const picked = chosen?.date === slot.date && chosen.start === slot.start;
            return (
              <Button key={key} type="button" variant="secondary" aria-pressed={picked} className={`w-full ${picked ? "border-line bg-line/15 text-white" : ""}`} disabled={busy} onClick={() => { setChosen(slot); setError(null); setPrompt(null); }}>
                {slot.label}
              </Button>
            );
          })}
        </div>
      )}
      {heldTimes.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm text-mist">These times are held for a later week.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {heldTimes.map((slot) => {
              const key = `held-${slot.date}-${slot.start}`;
              const picked = chosen?.date === slot.date && chosen.start === slot.start;
              return (
                <Button key={key} type="button" variant="secondary" aria-pressed={picked} className={`w-full ${picked ? "border-line bg-line/15 text-white" : ""}`} disabled={busy} onClick={() => { setChosen(slot); setError(null); setPrompt(null); }}>
                  {slot.label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
      {chosen && !prompt ? (
        <ConfirmTimeDialog
          title={`Move ${court.courtName}?`}
          detail={heldTimes.some((slot) => slot.date === chosen.date && slot.start === chosen.start) ? `${chosen.label} is held for a later week. Confirming leaves this court where it is.` : `This court will move to ${chosen.label}. Nothing changes until you confirm.`}
          error={error}
          loading={movingKey !== null}
          onConfirm={() => void move(chosen)}
          onCancel={() => { setChosen(null); setError(null); }}
        />
      ) : null}
      {prompt ? (
        <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-400/10 p-3" role="status">
          <p className="text-sm font-semibold text-white">
            {prompt.code === "PRICE_INCREASE" ? "This time costs more" : "This time costs less"}
          </p>
          <p className="mt-2 text-sm text-mist/80">
            You paid <Money amount={prompt.paid} currency={court.currency} /> for this court. The new time is <Money amount={prompt.quote} currency={court.currency} />.
            {prompt.code === "PRICE_INCREASE" ? <> Pay <Money amount={prompt.difference} currency={court.currency} /> more to confirm. The extra time is kept only after that payment.</> : prompt.refundAmount > 0 ? <> Refund <Money amount={prompt.refundAmount} currency={court.currency} /> to your card?</> : <> No card refund is due. Change the time anyway?</>}
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            {prompt.code === "PRICE_INCREASE" ? (
              <Button type="button" className="w-full sm:w-auto" loading={accepting} disabled={busy && !accepting} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => void move(prompt.slot, true, false)}>Pay the difference</Button>
            ) : (
              <Button type="button" className="w-full sm:w-auto" loading={accepting} disabled={busy && !accepting} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />} onClick={() => void move(prompt.slot, false, true)}>{prompt.refundAmount > 0 ? "Yes, refund and change" : "Yes, change the time"}</Button>
            )}
            <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={() => setPrompt(null)}>No, keep this time</Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-3 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100" role="alert">{error}</p> : null}
      <Button type="button" variant="secondary" className="mt-3 w-full sm:w-auto" disabled={busy} icon={<X className="h-4 w-4" aria-hidden="true" />} onClick={onClose}>Keep current time</Button>
    </div>
  );
}
