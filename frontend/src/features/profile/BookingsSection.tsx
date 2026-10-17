import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarClock, CalendarDays, ChevronDown, CircleAlert, CircleCheck, Clock, CreditCard, Eye, Gift, MapPin, Repeat, ShieldCheck, TriangleAlert, Undo2, Unlock, UserPlus, Users, X } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { useVenues } from "../../components/layout/SiteLayout";
import { addHoldCourts, bookAgainPath, venueAvailability, venueForPage } from "../venues/venueApi";
import { AuthRequestError } from "../auth/authApi";
import { cancelBooking, deleteSeries, deleteSeriesPreview, deleteUnpaidHold, moveCourtSessions, myBookings, myCourtWeeks, refreshUnpaidHolds, setCourtRepeat, type BookingRow, type CancelResult, type CourtWeekCourt, type Page, type SeriesCancelPreview } from "./profileApi";
import { RecommendationBanner } from "./RecommendationNotice";
import { ListPager } from "./ProfileLists";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

function formatWeekDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function weekOfYear(value: string, timeZone: string) {
  const zone = timeZone || "Australia/Melbourne";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  const calendar = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
  const isoDay = weekday === 0 ? 7 : weekday;
  const thursday = new Date(calendar);
  thursday.setUTCDate(calendar.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const monday = new Date(calendar);
  monday.setUTCDate(calendar.getUTCDate() - (isoDay - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return { week, year: thursday.getUTCFullYear(), from: day.format(monday), to: day.format(sunday) };
}

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

function overlaps(start: string, end: string, otherStart: string, otherEnd: string) {
  return new Date(otherStart).getTime() < new Date(end).getTime() && new Date(otherEnd).getTime() > new Date(start).getTime();
}

const holdFilters = [
  { id: "all", label: "All" },
  { id: "pay", label: "Need payment" },
  { id: "repeat", label: "Repeating" },
] as const;

function seriesNeedsPayment(weeks: CourtWeekCourt[][]) {
  return weeks.some((week) => week.some((court) => court.status === "pending"));
}

function visibleSeries(weeks: CourtWeekCourt[][], filter: (typeof holdFilters)[number]["id"]) {
  const groups = new Map<string, CourtWeekCourt[][]>();
  for (const week of weeks) {
    const id = week[0].groupId;
    groups.set(id, [...(groups.get(id) ?? []), week]);
  }
  return [...groups.values()].filter((group) => {
    if (filter === "pay") return seriesNeedsPayment(group);
    if (filter === "repeat") return group.some((week) => week[0].repeatHold);
    return true;
  });
}

function weekSpan(weeks: CourtWeekCourt[][]) {
  const first = weekOfYear(weeks[0][0].startTime, weeks[0][0].timeZone);
  const last = weekOfYear(weeks[weeks.length - 1][0].startTime, weeks[weeks.length - 1][0].timeZone);
  if (weeks.length === 1 || (first.week === last.week && first.year === last.year)) {
    return `Week ${first.week} of ${first.year}`;
  }
  if (first.year === last.year) {
    return `Weeks ${first.week}–${last.week} of ${first.year}`;
  }
  return `Weeks ${first.week} of ${first.year} to ${last.week} of ${last.year}`;
}

type TimeFields = { date: string; start: string; end: string };

function clockLabel(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

function fieldsLabel(fields: TimeFields) {
  const [year, month, day] = fields.date.split("-").map(Number);
  const date = year && month && day
    ? new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)))
    : fields.date;
  return `${date}, ${clockLabel(fields.start)} – ${clockLabel(fields.end)}`;
}

function ReschedulePanel({
  title,
  scope,
  court,
  value,
  original,
  paid,
  moving,
  locked,
  onChange,
  onConfirm,
  onClose,
}: {
  title: string;
  scope: string;
  court: CourtWeekCourt;
  value: TimeFields;
  original: TimeFields;
  paid: boolean;
  moving: boolean;
  locked: boolean;
  onChange: (next: TimeFields) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const changed = value.date !== original.date || value.start !== original.start || value.end !== original.end;
  const complete = Boolean(value.date && value.start && value.end);
  const input = "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]";
  return (
    <div className="mt-3 rounded-xl border border-line/30 bg-line/5 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-white">
        <CalendarClock className="h-4 w-4 shrink-0 text-line" aria-hidden="true" />
        {title}
      </p>
      <p className="mt-1 text-xs text-mist/70">
        Currently {formatWeekDate(court.startTime, court.timeZone)} · {formatVenueRange(court.startTime, court.endTime, court.timeZone)}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-sm text-mist">
          <span className="mb-1 block text-mist/70">New date</span>
          <PickerInput type="date" required value={value.date} disabled={locked} onChange={(event) => onChange({ ...value, date: event.target.value })} className={input} />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block text-mist/70">Start</span>
          <PickerInput type="time" required value={value.start} disabled={locked} onChange={(event) => onChange({ ...value, start: event.target.value })} className={input} />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block text-mist/70">End</span>
          <PickerInput type="time" required value={value.end} disabled={locked} onChange={(event) => onChange({ ...value, end: event.target.value })} className={input} />
        </label>
      </div>
      {changed && complete ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-black/25 px-3 py-2 text-sm" aria-live="polite">
          <span className="text-mist/60 line-through">{fieldsLabel(original)}</span>
          <ArrowRight className="h-4 w-4 shrink-0 text-line" aria-hidden="true" />
          <span className="font-semibold text-white">{fieldsLabel(value)}</span>
        </p>
      ) : null}
      <ul className="mt-3 grid gap-1 text-xs leading-5 text-mist/70">
        <li>{scope}</li>
        <li>If a court is booked or closed at the new time, nothing moves and we tell you which court.</li>
        {paid ? <li>Paid courts keep the price you paid.</li> : null}
      </ul>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button type="button" className="w-full sm:w-auto" loading={moving} disabled={(locked && !moving) || !changed || !complete} icon={<CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={onConfirm}>
          Confirm new time
        </Button>
        <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={locked} icon={<Undo2 className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={onClose}>
          Keep current time
        </Button>
      </div>
    </div>
  );
}

function WeekEditor({ courts, onChanged }: { courts: CourtWeekCourt[]; onChanged: () => void }) {
  const first = courts[0];
  const [checked, setChecked] = useState(() => new Set(courts.map((court) => court.courtId)));
  const [choices, setChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingCourts, setLoadingCourts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const openedAt = venueFields(first.startTime, first.timeZone);
  const closedAt = venueFields(first.endTime, first.timeZone);
  const weekOriginal = { date: openedAt.date, start: openedAt.time, end: closedAt.time };
  const [when, setWhen] = useState(weekOriginal);
  const [rescheduling, setRescheduling] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionWhen, setSessionWhen] = useState(when);
  const locked = saving || loadingCourts || moving || deleting;
  const sessionCourt = sessionId ? courts.find((court) => court.bookingId === sessionId) ?? null : null;
  const sessionOriginal = sessionCourt
    ? { date: venueFields(sessionCourt.startTime, sessionCourt.timeZone).date, start: venueFields(sessionCourt.startTime, sessionCourt.timeZone).time, end: venueFields(sessionCourt.endTime, sessionCourt.timeZone).time }
    : weekOriginal;
  const courtsLocked = locked || rescheduling || sessionCourt !== null;
  const held = new Set(courts.map((court) => court.courtId));
  const removed = courts.filter((court) => !checked.has(court.courtId));
  const added = [...checked].filter((id) => !held.has(id));
  const selected = courts.filter((court) => checked.has(court.courtId));
  const total = selected.reduce((sum, court) => sum + court.price, 0) + added.length * first.price;
  const dirty = removed.length > 0 || added.length > 0;
  const pending = selected.filter((court) => court.status === "pending");
  const options = choices ?? courts.map((court) => ({ id: court.courtId, name: court.courtName }));
  const currentTotal = courts.reduce((sum, court) => sum + court.price, 0);
  const removedPaid = removed.filter((court) => court.status === "confirmed");
  const addedNames = added.map((id) => options.find((court) => court.id === id)?.name ?? "Court");
  const navigate = useNavigate();
  const payNow = added.length > 0 && new Date(first.startTime).getTime() - Date.now() <= 24 * 60 * 60 * 1000;

  function undoChanges() {
    setChecked(new Set(courts.map((court) => court.courtId)));
    setConfirmPaid(false);
    setError(null);
  }

  async function loadCourts() {
    setLoadingCourts(true);
    setError(null);
    try {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: first.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.startTime));
      const availability = await venueAvailability(first.venueSlug, day, "", "");
      setChoices(availability.courts
        .filter((court) => held.has(court.id) || !court.bookings.some((booking) => overlaps(first.startTime, first.endTime, booking.startTime, booking.endTime)))
        .map((court) => ({ id: court.id, name: court.courtName })));
    } catch {
      setError("Courts could not be loaded.");
    } finally {
      setLoadingCourts(false);
    }
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
      if (payNow) {
        refreshUnpaidHolds();
        navigate(bookAgainPath(first.venueSlug, { ...weekOriginal, courtIds: added, weeks: 1, repeat: false }));
        return;
      }
      if (added.length > 0) {
        await addHoldCourts(first.venueSlug, first.groupId, first.startTime, first.endTime, added);
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

  async function saveTime(bookingId?: string, fields = when) {
    const court = bookingId ? courts.find((item) => item.bookingId === bookingId) : first;
    if (!court) return;
    setMoving(true);
    setError(null);
    try {
      await moveCourtSessions(first.groupId, {
        startTime: court.startTime,
        bookingId,
        date: fields.date,
        start: fields.start,
        end: fields.end,
      });
      setRescheduling(false);
      setSessionId(null);
      refreshUnpaidHolds();
      onChanged();
    } catch (reason) {
      setError(requestMessage(reason, "That date and time is not available."));
    } finally {
      setMoving(false);
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
      const pending = courts.filter((court) => court.status === "pending");
      const paid = courts.filter((court) => court.status === "confirmed");
      if (pending.length > 0) {
        await deleteUnpaidHold(first.groupId, pending.map((court) => court.bookingId));
      } else if (first.repeatHold) {
        await setCourtRepeat(first.groupId, false);
      }
      for (const court of paid) {
        await cancelBooking(court.bookingId);
      }
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
        {options.map((court) => {
          const row = courts.find((item) => item.courtId === court.id);
          return (
            <li key={court.id}>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-mist">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-line"
                  checked={checked.has(court.id)}
                  disabled={courtsLocked}
                  onChange={() => {
                    setConfirmPaid(false);
                    setChecked((current) => {
                      const next = new Set(current);
                      if (next.has(court.id)) next.delete(court.id);
                      else next.add(court.id);
                      return next;
                    });
                  }}
                />
                <span className={`min-w-0 ${row && !checked.has(court.id) ? "text-mist/50 line-through" : ""}`}>{court.name}</span>
                <span className="ml-auto text-xs text-mist/60">{row ? (row.status === "confirmed" ? "Paid" : "Held") : "Add"}</span>
              </label>
              {row ? (
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-line hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={locked || dirty}
                  onClick={() => {
                    const clock = venueFields(row.startTime, row.timeZone);
                    const finish = venueFields(row.endTime, row.timeZone);
                    setRescheduling(false);
                    setWhen(weekOriginal);
                    setSessionId(row.bookingId);
                    setSessionWhen({ date: clock.date, start: clock.time, end: finish.time });
                    setError(null);
                  }}
                >
                  <CalendarClock className="h-3 w-3" aria-hidden="true" />
                  Reschedule
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {dirty ? (
        <div className={`mt-3 rounded-xl border p-3 ${confirmPaid ? "border-amber-300/50 bg-amber-400/10" : "border-line/30 bg-line/5"}`} role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            {confirmPaid ? <TriangleAlert className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" /> : <CircleAlert className="h-4 w-4 shrink-0 text-line" aria-hidden="true" />}
            {confirmPaid ? "Please confirm before we cancel paid courts" : "You have unsaved changes for this week"}
          </p>
          <div className="mt-2 grid gap-2 text-sm">
            {removed.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-mist/70">Dropping:</span>
                {removed.map((court) => (
                  <span key={court.bookingId} className="inline-flex items-center gap-1 rounded-full border border-rose-300/40 bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-100">
                    <X className="h-3 w-3" aria-hidden="true" />
                    {court.courtName}
                    <span className="text-rose-100/70">· {court.status === "confirmed" ? "Paid" : "Held"}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {addedNames.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-mist/70">Adding:</span>
                {addedNames.map((name, index) => (
                  <span key={`${name}-${index}`} className="inline-flex items-center gap-1 rounded-full border border-line/40 bg-line/10 px-2 py-0.5 text-xs font-medium text-line">
                    <CircleCheck className="h-3 w-3" aria-hidden="true" />
                    {name}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="text-mist/80">
              Weekly total:{" "}
              <span className="text-mist/60 line-through"><Money amount={currentTotal} currency={first.currency} /></span>{" "}
              <span className="font-semibold text-white"><Money amount={total} currency={first.currency} /></span>
              <span className="text-mist/60"> · {selected.length + added.length} {selected.length + added.length === 1 ? "court" : "courts"} kept</span>
            </p>
          </div>
          {payNow ? (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-black/20 px-2.5 py-2 text-xs leading-5 text-mist/80">
              <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-line" aria-hidden="true" />
              <span>
                This session starts within 24 hours, so new courts are paid when you add them.
                {" "}Continue to payment opens checkout with {addedNames.join(", ")} at this time. We check they are still free before you pay.
              </span>
            </p>
          ) : null}
          {removedPaid.length > 0 ? (
            <p className={`mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs leading-5 ${confirmPaid ? "bg-amber-400/15 text-amber-100" : "bg-black/20 text-mist/80"}`}>
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {removedPaid.length} paid {removedPaid.length === 1 ? "court is" : "courts are"} cancelled under the cancellation policy.
                {confirmPaid ? " Press Confirm update to continue, or Cancel changes to keep your booking as it was." : ""}
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-mist/75">Untick a court to drop it. The total follows the courts you leave ticked.</p>
      )}
      {confirmDelete ? <p className="mt-2 text-sm text-mist" role="status">Delete this week? Unpaid courts are released. A paid court is cancelled under the cancellation policy. Keep weeks ahead is turned off so this week is not added back.</p> : null}
      {error ? <p className="mt-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-100" role="alert">{error}</p> : null}
      {sessionCourt ? (
        <ReschedulePanel
          title={`Reschedule ${sessionCourt.courtName}`}
          scope={`Only ${sessionCourt.courtName} moves. The other courts stay at their current time.`}
          court={sessionCourt}
          value={sessionWhen}
          original={sessionOriginal}
          paid={sessionCourt.status === "confirmed"}
          moving={moving}
          locked={locked}
          onChange={(next) => { setError(null); setSessionWhen(next); }}
          onConfirm={() => void saveTime(sessionCourt.bookingId, sessionWhen)}
          onClose={() => { setSessionId(null); setError(null); }}
        />
      ) : rescheduling ? (
        <ReschedulePanel
          title="Reschedule this week"
          scope={`All ${courts.length} ${courts.length === 1 ? "court moves" : "courts move"} together.`}
          court={first}
          value={when}
          original={weekOriginal}
          paid={courts.some((court) => court.status === "confirmed")}
          moving={moving}
          locked={locked}
          onChange={(next) => { setError(null); setWhen(next); }}
          onConfirm={() => void saveTime()}
          onClose={() => { setRescheduling(false); setWhen(weekOriginal); setError(null); }}
        />
      ) : (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm text-mist/80">
            <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-line" aria-hidden="true" />
            <span>
              <span className="font-medium text-white">Need a different day or time?</span>
              <span className="block text-xs text-mist/60">{dirty ? "Update or cancel your court changes first." : "Move every court in this week in one step."}</span>
            </span>
          </p>
          <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={locked || dirty} icon={<CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={() => { setRescheduling(true); setError(null); }}>
            Reschedule this week
          </Button>
        </div>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" variant="danger" className="w-full sm:w-auto" loading={deleting} disabled={locked && !deleting} onClick={() => void removeWeek()}>{confirmDelete ? "Confirm delete" : "Delete this week"}</Button>
        {choices === null ? (
          <Button type="button" variant="secondary" className="w-full sm:w-auto" loading={loadingCourts} disabled={courtsLocked && !loadingCourts} onClick={() => void loadCourts()}>Add another court</Button>
        ) : null}
        {dirty ? (
          <>
            <Button type="button" className="w-full sm:w-auto" loading={saving} disabled={locked && !saving} icon={payNow ? <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" /> : undefined} onClick={() => void save()}>
              {confirmPaid ? "Confirm update" : payNow ? "Continue to payment" : "Update this week"}
            </Button>
            <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={locked} icon={<Undo2 className="h-4 w-4 shrink-0" aria-hidden="true" />} onClick={undoChanges}>
              Cancel changes
            </Button>
          </>
        ) : pending.length > 0 ? (
          <Link to={`/${first.venueSlug}/book/group/${first.groupId}?bookings=${pending.map((court) => court.bookingId).join(",")}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
            Pay this week
          </Link>
        ) : (
          <p className="text-sm text-line">This week is paid.</p>
        )}
      </div>
    </div>
  );
}

function WeekPayStatus({ courts }: { courts: CourtWeekCourt[] }) {
  const paid = courts.filter((court) => court.status === "confirmed").length;
  if (paid === courts.length) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line/40 bg-line/15 px-2 py-0.5 text-xs font-semibold text-line">
        <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Paid
      </span>
    );
  }
  const dueAt = new Date(courts[0].startTime).getTime() - 24 * 60 * 60 * 1000;
  const dueNow = dueAt <= Date.now();
  const Icon = dueNow ? CircleAlert : Clock;
  const tone = dueNow ? "border-rose-300/50 bg-rose-500/15 text-rose-100" : "border-amber-300/40 bg-amber-400/15 text-amber-100";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {paid > 0 ? `Partly paid · ${paid} of ${courts.length}` : dueNow ? "Pay now" : "Held for you"}
    </span>
  );
}

function weekPayNote(courts: CourtWeekCourt[]) {
  if (courts.every((court) => court.status === "confirmed")) return null;
  const due = new Date(new Date(courts[0].startTime).getTime() - 24 * 60 * 60 * 1000);
  return due.getTime() <= Date.now() ? "Pay now to keep this week." : `Pay before ${formatVenueDateTime(due.toISOString(), courts[0].timeZone)}.`;
}

function SeriesCard({ weeks, open, onToggle, openWeek, onOpenWeek, onChanged }: { weeks: CourtWeekCourt[][]; open: boolean; onToggle: () => void; openWeek: string | null; onOpenWeek: (key: string | null) => void; onChanged: () => void }) {
  const ordered = [...weeks].sort((left, right) => left[0].startTime < right[0].startTime ? -1 : 1);
  const sample = ordered[0][0];
  const next = ordered.find((week) => new Date(week[0].endTime).getTime() > Date.now()) ?? ordered[0];
  const nextUnpaid = ordered.find((week) => week.some((court) => court.status === "pending"));
  const securedWeeks = ordered.filter((week) => week.every((court) => court.status === "confirmed")).length;
  const heldWeeks = ordered.length - securedWeeks;
  const horizon = sample.seriesWeeks || ordered.length;
  const due = nextUnpaid ? new Date(new Date(nextUnpaid[0].startTime).getTime() - 24 * 60 * 60 * 1000) : null;
  const dueSoon = due !== null && due.getTime() <= Date.now();
  const note = ordered.find((week) => week[0].repeatNote)?.[0].repeatNote;
  const [repeatBusy, setRepeatBusy] = useState(false);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [confirmSeries, setConfirmSeries] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesPreview, setSeriesPreview] = useState<SeriesCancelPreview | null>(null);
  const unpaidCourts = ordered.flat().filter((court) => court.status === "pending" && new Date(court.startTime).getTime() > Date.now()).length;

  async function removeSeries() {
    if (!confirmSeries) {
      setSeriesBusy(true);
      setSeriesError(null);
      try {
        setSeriesPreview(await deleteSeriesPreview(sample.groupId));
        setConfirmSeries(true);
      } catch (reason) {
        setSeriesError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "The refund could not be checked." : "The refund could not be checked.");
      } finally {
        setSeriesBusy(false);
      }
      return;
    }
    setSeriesBusy(true);
    setSeriesError(null);
    try {
      await deleteSeries(sample.groupId);
      refreshUnpaidHolds();
      onChanged();
    } catch (reason) {
      setSeriesError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This booking could not be deleted." : "This booking could not be deleted.");
    } finally {
      setSeriesBusy(false);
    }
  }

  async function onRepeat(enabled: boolean) {
    setRepeatBusy(true);
    setRepeatError(null);
    try {
      const saved = await setCourtRepeat(sample.groupId, enabled);
      if (saved.note) setRepeatError(saved.note);
      onChanged();
    } catch (reason) {
      setRepeatError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This repeat could not be saved." : "This repeat could not be saved.");
    } finally {
      setRepeatBusy(false);
    }
  }

  return (
    <li className="rounded-2xl border border-white/10 p-4 transition-colors hover:border-line/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button type="button" className="min-w-0 flex-1 rounded-xl px-1 py-1 text-left transition-colors hover:bg-white/5" aria-expanded={open} onClick={onToggle}>
          <span className="flex items-start gap-2">
            <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-mist transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block font-medium text-white">{sample.venueName}</span>
              <span className="mt-1 block text-sm text-mist">{formatVenueRange(sample.startTime, sample.endTime, sample.timeZone)}</span>
              <span className="mt-1 block text-sm leading-relaxed text-mist/80">{weekSpan(ordered)}. {ordered.length} {ordered.length === 1 ? "week" : "weeks"} at this time. Next session {formatWeekDate(next[0].startTime, next[0].timeZone)}.</span>
              <span className="mt-1 block text-sm text-white">{securedWeeks} {securedWeeks === 1 ? "week" : "weeks"} secured · {heldWeeks} {heldWeeks === 1 ? "week" : "weeks"} held.{due ? dueSoon ? " The next session is inside 24 hours. Pay now to keep it." : ` Pay the next week before ${formatVenueDateTime(due.toISOString(), sample.timeZone)}.` : ""}</span>
            </span>
          </span>
        </button>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
          {nextUnpaid ? (
            <Link to={`/${sample.venueSlug}/book/group/${sample.groupId}?bookings=${nextUnpaid.filter((court) => court.status === "pending").map((court) => court.bookingId).join(",")}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
              <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
              Pay next week
            </Link>
          ) : (
            <p className="text-sm font-semibold text-line sm:pt-1">All weeks are paid.</p>
          )}
          <Button type="button" variant="danger" className="w-full sm:w-auto" loading={seriesBusy} disabled={seriesBusy || repeatBusy} onClick={() => void removeSeries()}>
            {confirmSeries ? "Confirm delete" : "Delete all weeks"}
          </Button>
        </div>
      </div>
      {confirmSeries && seriesPreview && !seriesBusy ? (
        <div className="mt-3 rounded-2xl border border-rose-300/40 bg-rose-500/10 p-3 sm:p-4" role="status">
          <p className="flex items-center gap-2 font-semibold text-rose-100">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            Delete every week in this booking?
          </p>
          <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-mist">
            {unpaidCourts > 0 ? (
              <li className="flex items-start gap-2">
                <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
                <span>{unpaidCourts} unpaid {unpaidCourts === 1 ? "court is" : "courts are"} released. Nothing is charged.</span>
              </li>
            ) : null}
            {seriesPreview.paidCourts > 0 ? (
              <li className="flex items-start gap-2">
                <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-line" aria-hidden="true" />
                <span>
                  {seriesPreview.paidCourts} paid {seriesPreview.paidCourts === 1 ? "court is" : "courts are"} cancelled. You paid <Money amount={seriesPreview.charged} currency={seriesPreview.currency} />.{" "}
                  <span className="font-semibold text-white"><Money amount={seriesPreview.refund} currency={seriesPreview.currency} /> is refunded to your card.</span>
                </span>
              </li>
            ) : null}
            {seriesPreview.fee > 0 ? (
              <li className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" aria-hidden="true" />
                <span>
                  {seriesPreview.lateCourts} paid {seriesPreview.lateCourts === 1 ? "court starts" : "courts start"} within 24 hours, so the venue keeps{" "}
                  <span className="font-semibold text-rose-100"><Money amount={seriesPreview.fee} currency={seriesPreview.currency} /></span> ({Number(seriesPreview.feePercent.toFixed(2))}% late-cancel fee).
                </span>
              </li>
            ) : seriesPreview.paidCourts > 0 ? (
              <li className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-line" aria-hidden="true" />
                <span>Every paid court is more than 24 hours away, so the refund is in full.</span>
              </li>
            ) : null}
            {seriesPreview.pointsBack > 0 || seriesPreview.pointsKept > 0 ? (
              <li className="flex items-start gap-2">
                <Gift className="mt-0.5 h-4 w-4 shrink-0 text-line" aria-hidden="true" />
                <span>
                  {seriesPreview.pointsBack > 0 ? `${seriesPreview.pointsBack} points come back to your balance.` : ""}
                  {seriesPreview.pointsBack > 0 && seriesPreview.pointsKept > 0 ? " " : ""}
                  {seriesPreview.pointsKept > 0 ? `${seriesPreview.pointsKept} points are kept by the venue.` : ""}
                </span>
              </li>
            ) : null}
            <li className="flex items-start gap-2">
              <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-mist/70" aria-hidden="true" />
              <span>Keep weeks ahead is turned off, so no week is added back.</span>
            </li>
          </ul>
          <Button type="button" variant="secondary" className="mt-3 w-full sm:w-auto" onClick={() => { setConfirmSeries(false); setSeriesPreview(null); }}>Keep all weeks</Button>
        </div>
      ) : null}
      {seriesError ? <p className="mt-3 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-100" role="alert">{seriesError}</p> : null}
      {open ? (
        <div className="mt-4">
          <label className="flex items-start gap-2 text-sm text-mist">
            <input type="checkbox" className="mt-1 accent-line" checked={Boolean(sample.repeatHold)} disabled={repeatBusy} onChange={(event) => void onRepeat(event.target.checked)} />
            <span>Keep {horizon} {horizon === 1 ? "week" : "weeks"} ahead. When one week starts, the next free week is held for you. You still pay each week before 24 hours of that session.</span>
          </label>
          {repeatBusy ? <span className="mt-2 inline-flex items-center gap-2 text-sm text-mist" role="status"><Spinner className="h-3.5 w-3.5" /> Saving repeat</span> : null}
          {note ? <p className="mt-2 text-sm text-mist" role="status">{note}</p> : null}
          {repeatError && repeatError !== note ? <p className="mt-2 text-sm text-mist" role="alert">{repeatError}</p> : null}
          <p className="mt-3 text-sm text-mist/75">No deposit. Open one week to change its courts. Pay that week before 24 hours of the session, or those courts are released.</p>
          <ul className="mt-3 space-y-2">
            {ordered.map((courts) => {
              const key = `${courts[0].groupId}|${courts[0].startTime}`;
              const yearWeek = weekOfYear(courts[0].startTime, courts[0].timeZone);
              const amount = courts.reduce((sum, court) => sum + court.price, 0);
              const opened = openWeek === key;
              const payNote = weekPayNote(courts);
              const allPaid = payNote === null;
              return (
                <li key={key} className={`rounded-xl border border-l-4 border-white/10 ${allPaid ? "border-l-line/70" : "border-l-amber-300/70"}`}>
                  <button type="button" className="flex w-full flex-col gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-line/10 sm:flex-row sm:items-center sm:justify-between" aria-expanded={opened} onClick={() => onOpenWeek(opened ? null : key)}>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">Week {yearWeek.week} of {yearWeek.year}</span>
                        <WeekPayStatus courts={courts} />
                      </span>
                      <span className="block text-sm text-mist/75">{formatWeekDate(courts[0].startTime, courts[0].timeZone)} · {courts.length} {courts.length === 1 ? "court" : "courts"}</span>
                      {payNote ? <span className="block text-sm text-amber-100/90">{payNote}</span> : null}
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold text-white"><Money amount={amount} currency={courts[0].currency} /></span>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-mist">
                        {opened ? "Hide courts" : "Show courts"}
                        <ChevronDown className={`h-4 w-4 transition-transform ${opened ? "rotate-180" : ""}`} aria-hidden="true" />
                      </span>
                    </span>
                  </button>
                  {opened ? <div className="px-3 pb-3"><WeekEditor key={courts.map((court) => court.bookingId).join("-")} courts={courts} onChanged={onChanged} /></div> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function cancelNotice(result: CancelResult) {
  const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: result.currency }).format(result.refundAmount);
  const parts = [`Cancelled. Refund amount: ${money}.`];
  if (result.feePercent > 0) {
    parts.push(`A ${Number(result.feePercent.toFixed(2))}% late fee was kept.`);
  }
  if (result.pointsRestored > 0) {
    parts.push(`${result.pointsRestored} points were returned.`);
  }
  return parts.join(" ");
}

export function BookingsSection() {
  const { venues, defaultSlug } = useVenues();
  const [params] = useSearchParams();
  const venue = venueForPage(venues, params.get("venue") ?? undefined, defaultSlug);
  if (venues === null) {
    return (
      <div>
        <h1 className="font-display text-3xl text-white">My bookings</h1>
        <RecommendationBanner />
        <div className="mt-4 space-y-3" aria-busy="true">
          <span className="sr-only">Loading bookings</span>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }
  return <VenueBookings key={venue?.slug ?? "all"} venueSlug={venue?.slug ?? null} venueName={venue?.name ?? null} />;
}

function VenueBookings({ venueSlug, venueName }: { venueSlug: string | null; venueName: string | null }) {
  const dispatch = useDispatch<AppDispatch>();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("upcoming");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [data, setData] = useState<Page<BookingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMove, setPageMove] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [weeks, setWeeks] = useState<CourtWeekCourt[][] | null>(null);
  const [holdFilter, setHoldFilter] = useState<(typeof holdFilters)[number]["id"]>("all");
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [seriesPage, setSeriesPage] = useState(1);
  const [seriesPageSize, setSeriesPageSize] = useState(5);
  const series = weeks ? visibleSeries(weeks, holdFilter) : [];
  const seriesPageNow = Math.min(seriesPage, Math.max(1, Math.ceil(series.length / seriesPageSize)));

  useEffect(() => {
    let active = true;
    setLoading(true);
    myBookings(tab, page, venueSlug, pageSize)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
          void dispatch(loadCurrentUser());
        }
      })
      .catch(() => {
        if (active) setError("Bookings could not be loaded.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setPageMove(null);
        }
      });
    return () => {
      active = false;
    };
  }, [tab, page, pageSize, attempt, dispatch, venueSlug]);

  useEffect(() => {
    if (tab !== "upcoming") {
      return;
    }
    let active = true;
    myCourtWeeks()
      .then((result) => {
        if (!active) return;
        const grouped = new Map<string, CourtWeekCourt[]>();
        for (const row of result.weeks) {
          if (venueSlug && row.venueSlug !== venueSlug) continue;
          const key = `${row.groupId}|${row.startTime}`;
          grouped.set(key, [...(grouped.get(key) ?? []), row]);
        }
        setWeeks([...grouped.values()]);
      })
      .catch(() => {
        if (active) setWeeks([]);
      });
    return () => {
      active = false;
    };
  }, [tab, attempt, venueSlug]);

  async function onCancel(id: string) {
    setPendingId(id);
    setNotice(null);
    try {
      const result = await cancelBooking(id);
      setNotice(cancelNotice(result));
      void dispatch(loadCurrentUser());
      setConfirmId(null);
      setAttempt((value) => value + 1);
    } catch {
      setNotice("This booking could not be cancelled.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-white">My bookings</h1>
      {venueName ? <p className="mt-1 text-sm leading-relaxed text-mist/75">Showing bookings at <span className="font-semibold text-white">{venueName}</span>. Choose another venue in the menu above to see its bookings.</p> : null}
      <RecommendationBanner />
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Booking status">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-busy={loading && pageMove === null && tab === item.id}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${tab === item.id ? "bg-line text-ink" : "border border-white/10 text-mist"}`}
            onClick={() => {
              if (item.id === tab) {
                return;
              }
              setError(null);
              setPageMove(null);
              setLoading(true);
              setTab(item.id);
              setPage(1);
            }}
          >
            {loading && pageMove === null && tab === item.id ? <Spinner className="h-3.5 w-3.5" /> : null}
            {item.label}
          </button>
        ))}
      </div>
      {notice ? <p className="mt-4 text-sm text-mist" role="status">{notice}</p> : null}
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <span className="sr-only">Loading bookings</span>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
      {tab === "upcoming" && weeks && weeks.length > 0 ? (
        <>
          <h2 className="mt-6 font-display text-2xl text-white">Court bookings</h2>
          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Court hold view">
            {holdFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={holdFilter === item.id}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${holdFilter === item.id ? "bg-line text-ink" : "border border-white/10 text-mist hover:bg-white/10"}`}
                onClick={() => { setHoldFilter(item.id); setSeriesPage(1); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {series.length === 0 ? (
            <p className="mt-4 text-sm text-mist">No court holds match this view.</p>
          ) : (
            <>
            <ul className="mt-4 space-y-3">
              {series.slice((seriesPageNow - 1) * seriesPageSize, seriesPageNow * seriesPageSize).map((group) => (
                <SeriesCard
                  key={group[0][0].groupId}
                  weeks={group}
                  open={openSeries === group[0][0].groupId}
                  onToggle={() => setOpenSeries((current) => current === group[0][0].groupId ? null : group[0][0].groupId)}
                  openWeek={openWeek}
                  onOpenWeek={setOpenWeek}
                  onChanged={() => setAttempt((value) => value + 1)}
                />
              ))}
            </ul>
            <ListPager
              page={seriesPageNow}
              pageSize={seriesPageSize}
              total={series.length}
              loading={false}
              pageMove={null}
              onPage={(next) => setSeriesPage(next)}
              onPageSize={(size) => { setSeriesPageSize(size); setSeriesPage(1); }}
            />
            </>
          )}
        </>
      ) : null}
      {data && data.items.length > 0 ? (
        <>
        {tab === "upcoming" && weeks && weeks.length > 0 ? (
          <h2 className="mt-8 font-display text-2xl text-white">{data.items.every((item) => item.socialId) ? "Public socials" : "Other bookings"}</h2>
        ) : null}
        <ul className="mt-4 space-y-3">
          {(tab === "upcoming" ? data.items.map((item) => [item]) : sessionGroups(data.items)).map((group) => {
            if (group.length > 1) {
              const key = sessionKey(group[0]);
              return (
                <SessionGroupCard
                  key={key}
                  bookings={group}
                  tab={tab}
                  open={openGroups.has(key)}
                  onToggle={() => setOpenGroups((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })}
                />
              );
            }
            const booking = group[0];
            return (
            <li key={booking.id} className="rounded-2xl border border-white/10 p-4">
              <BookingSummary booking={booking} tab={tab} />
              {booking.socialId && booking.canCancel && booking.status !== "waitlist" ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Link to={`/${booking.venueSlug}/social/${booking.socialId}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
                    <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Add friends
                  </Link>
                  {confirmId === booking.id ? (
                    <>
                      <Button variant="danger" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={pendingId === booking.id} onClick={() => void onCancel(booking.id)}>Confirm cancel</Button>
                      <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId === booking.id} onClick={() => setConfirmId(null)}>Keep booking</Button>
                    </>
                  ) : (
                    <Button variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null} onClick={() => setConfirmId(booking.id)}>Cancel</Button>
                  )}
                </div>
              ) : booking.canCancel ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {confirmId === booking.id ? (
                    <>
                      <Button variant="danger" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={pendingId === booking.id} onClick={() => void onCancel(booking.id)}>Confirm cancel</Button>
                      <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId === booking.id} onClick={() => setConfirmId(null)}>Keep booking</Button>
                    </>
                  ) : (
                    <Button variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null} onClick={() => setConfirmId(booking.id)}>Cancel</Button>
                  )}
                </div>
              ) : null}
              {tab === "upcoming" && booking.socialId ? (
                <div className="mt-4">
                  <Button variant="secondary" className="w-full sm:w-auto" icon={<Eye className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpenId(openId === booking.id ? null : booking.id)}>
                    {openId === booking.id ? "Hide registration" : "View registration"}
                  </Button>
                  {openId === booking.id ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-sm font-medium text-white">Your place</p>
                      <p className="text-sm text-mist/80">{booking.status === "waitlist" ? "Waitlist · waiting for a place" : `${booking.courtName} · Court ${booking.courtNumber}`}</p>
                      <p className="text-sm text-mist/70">{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</p>
                      <p className="mt-3 text-sm font-medium text-white">Friends</p>
                      {(booking.friends ?? []).length === 0 ? (
                        <p className="text-sm text-mist/70">No friends on this social.</p>
                      ) : (
                        <ul className="mt-1">
                          {(booking.friends ?? []).map((friend) => (
                            <li key={friend.id} className="text-sm text-mist/80">{friend.name} · {friend.courtName || "Waitlist"} · {friend.status}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
            );
          })}
        </ul>
        </>
      ) : tab === "upcoming" && weeks && weeks.length > 0 ? null : (
        <div className="mt-4"><EmptyState title={emptyCopy[tab].title} body={emptyCopy[tab].body(venueName)} /></div>
      )}
        </>
      )}
      {data && !error && data.total > 0 ? (
        <ListPager
          page={page}
          pageSize={data.pageSize || pageSize}
          total={data.total}
          unit={tab === "upcoming" ? undefined : "sessions"}
          loading={loading}
          pageMove={pageMove}
          onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }}
          onPageSize={(size) => { setLoading(true); setPageMove(`size-${size}`); setPageSize(size); setPage(1); }}
        />
      ) : null}
    </div>
  );
}

const emptyCopy: Record<(typeof tabs)[number]["id"], { title: string; body: (venueName: string | null) => string }> = {
  upcoming: {
    title: "Nothing coming up",
    body: (venueName) => venueName ? `Courts and public socials you book at ${venueName} will show up here.` : "Courts and public socials you book will show up here.",
  },
  past: {
    title: "No past bookings yet",
    body: () => "Sessions move here after they finish, with any reward points you earned.",
  },
  cancelled: {
    title: "No cancelled bookings",
    body: () => "Bookings you cancel, and holds that expire before payment, are listed here with any refund.",
  },
};

function bookingStatus(booking: BookingRow, tab: (typeof tabs)[number]["id"]) {
  switch (booking.status) {
    case "pending":
      return { label: "Awaiting payment", tone: "bg-amber-400/15 text-amber-200" };
    case "waitlist":
      return { label: "Waitlist", tone: "bg-sky-400/15 text-sky-200" };
    case "completed":
      return { label: "Completed", tone: "bg-line/15 text-line" };
    case "no_show":
      return { label: "No-show", tone: "bg-rose-500/15 text-rose-200" };
    case "expired":
      return { label: "Hold expired", tone: "bg-white/10 text-mist" };
    case "cancelled":
      return { label: "Cancelled", tone: "bg-rose-500/15 text-rose-200" };
    default:
      return tab === "past" ? { label: "Played", tone: "bg-line/15 text-line" } : { label: "Confirmed", tone: "bg-line/15 text-line" };
  }
}

function startsIn(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "Starting now";
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Starts in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `Starts in ${days} ${days === 1 ? "day" : "days"}`;
}

function duration(start: string, end: string) {
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function sessionKey(booking: BookingRow) {
  return `${booking.venueSlug}|${booking.startTime}|${booking.endTime}|${booking.socialId ? "social" : "court"}`;
}

function sessionGroups(items: BookingRow[]) {
  const groups = new Map<string, BookingRow[]>();
  for (const item of items) {
    const key = sessionKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
}

function refundOf(booking: BookingRow) {
  if (booking.status !== "cancelled" || !booking.wasPaid) return 0;
  return Math.round(booking.totalAmount * (100 - (booking.cancelFeePercent ?? 0))) / 100;
}

function SessionGroupCard({
  bookings,
  tab,
  open,
  onToggle,
}: {
  bookings: BookingRow[];
  tab: (typeof tabs)[number]["id"];
  open: boolean;
  onToggle: () => void;
}) {
  const first = bookings[0];
  const zone = first.timeZone || "Australia/Melbourne";
  const start = new Date(first.startTime);
  const social = Boolean(first.socialId);
  const total = bookings.reduce((sum, item) => sum + item.totalAmount, 0);
  const points = bookings.reduce((sum, item) => sum + (item.pointsEarned ?? 0), 0);
  const refunded = bookings.reduce((sum, item) => sum + refundOf(item), 0);
  const pointsBack = bookings.reduce((sum, item) => sum + (item.pointsRedeemed ?? 0), 0);
  const charged = bookings.some((item) => item.wasPaid);
  const statuses = new Map<string, { count: number; tone: string }>();
  for (const item of bookings) {
    const status = bookingStatus(item, tab);
    const current = statuses.get(status.label);
    statuses.set(status.label, { count: (current?.count ?? 0) + 1, tone: status.tone });
  }
  const courtCounts = new Map<string, number>();
  for (const item of bookings) courtCounts.set(item.courtName, (courtCounts.get(item.courtName) ?? 0) + 1);
  const names = [...courtCounts.entries()].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name)).join(", ");
  const unit = social ? "places" : courtCounts.size === bookings.length ? "courts" : "bookings";
  const panelId = `session-${first.id}`;

  return (
    <li className="rounded-2xl border border-white/10">
      <div className="flex gap-3 p-4 sm:gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] py-2 text-center sm:w-16">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-line">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(start)}</span>
          <span className="font-display text-2xl leading-none text-white">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, day: "numeric" }).format(start)}</span>
          <span className="text-[11px] uppercase text-mist/70">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, month: "short" }).format(start)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-mist">
                  {social ? <Users className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
                  {social ? "Public social" : "Court booking"} · {bookings.length} {unit}
                </span>
                {[...statuses.entries()].map(([label, value]) => (
                  <span key={label} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${value.tone}`}>{value.count} {label}</span>
                ))}
              </div>
              <p className="mt-2 font-medium text-white">{first.venueName}</p>
              <p className="flex items-center gap-1.5 text-sm text-mist/80">
                <Clock className="h-3.5 w-3.5 shrink-0 text-mist/60" aria-hidden="true" />
                {formatVenueRange(first.startTime, first.endTime, first.timeZone)}
                <span className="text-mist/55">· {duration(first.startTime, first.endTime)}</span>
              </p>
              <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-5 text-mist/65">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mist/60" aria-hidden="true" />
                {names}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-white"><Money amount={total} currency={first.currency} /></p>
              <p className="text-xs text-mist/55">Total for {bookings.length} {unit}</p>
            </div>
          </div>
          <div className="mt-2 space-y-1 text-xs text-mist/65">
            {tab === "past" && points > 0 ? (
              <p className="flex items-center gap-1.5 text-line"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />+{points} reward points earned</p>
            ) : null}
            {tab === "cancelled" ? (
              refunded > 0 ? (
                <p className="flex items-center gap-1.5 text-sky-200"><Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Refunded <Money amount={refunded} currency={first.currency} /> in total</p>
              ) : !charged ? (
                <p className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Not charged</p>
              ) : null
            ) : null}
            {tab === "cancelled" && pointsBack > 0 && !social ? (
              <p className="flex items-center gap-1.5 text-line"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{pointsBack} points returned to your balance</p>
            ) : null}
          </div>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={onToggle}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            {open ? `Hide ${unit}` : `Show ${bookings.length} ${unit}`}
          </button>
        </div>
      </div>
      {open ? (
        <ul id={panelId} className="space-y-2 border-t border-white/10 bg-black/20 p-3 sm:p-4">
          {bookings.map((booking) => (
            <li key={booking.id} className="rounded-xl border border-white/10 bg-pine/40 p-3">
              <BookingSummary booking={booking} tab={tab} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function BookingSummary({ booking, tab }: { booking: BookingRow; tab: (typeof tabs)[number]["id"] }) {
  const zone = booking.timeZone || "Australia/Melbourne";
  const start = new Date(booking.startTime);
  const social = Boolean(booking.socialId);
  const status = bookingStatus(booking, tab);
  const subtotal = booking.subtotalAmount ?? booking.totalAmount;
  const discount = booking.discountAmount ?? 0;
  const pointsUsed = booking.pointsRedeemed ?? 0;
  const fee = booking.cancelFeePercent ?? 0;
  const lateFee = booking.lateFeePercent ?? 0;
  const freeUntil = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const soon = start.getTime() - Date.now() < 24 * 60 * 60 * 1000;
  const refund = booking.wasPaid ? Math.round(booking.totalAmount * (100 - fee)) / 100 : 0;
  const place = booking.status === "waitlist" ? "Waiting for a place on court" : social ? (booking.courtNumber > 0 ? `Court ${booking.courtNumber}` : "Court assigned on the day") : booking.courtName.trim().toLowerCase() === `court ${booking.courtNumber}` ? booking.courtName : `${booking.courtName} · Court ${booking.courtNumber}`;

  return (
    <div className="flex gap-3 sm:gap-4">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] py-2 text-center sm:w-16">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-line">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(start)}</span>
        <span className="font-display text-2xl leading-none text-white">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, day: "numeric" }).format(start)}</span>
        <span className="text-[11px] uppercase text-mist/70">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, month: "short" }).format(start)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-mist">
                {social ? <Users className="h-3.5 w-3.5" aria-hidden="true" /> : <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}
                {social ? "Public social" : "Court booking"}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
              {tab === "upcoming" ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${soon ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-mist/80"}`}>{startsIn(booking.startTime)}</span>
              ) : null}
            </div>
            <p className="mt-2 font-medium text-white">{booking.venueName}</p>
            <p className="flex items-center gap-1.5 text-sm text-mist/80"><MapPin className="h-3.5 w-3.5 shrink-0 text-mist/60" aria-hidden="true" />{place}</p>
            <p className="flex items-center gap-1.5 text-sm text-mist/80">
              <Clock className="h-3.5 w-3.5 shrink-0 text-mist/60" aria-hidden="true" />
              {formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}
              <span className="text-mist/55">· {duration(booking.startTime, booking.endTime)}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="font-semibold text-white"><Money amount={booking.totalAmount} currency={booking.currency} /></p>
            {discount > 0 || pointsUsed > 0 ? (
              <>
                {subtotal > booking.totalAmount ? <p className="text-xs text-mist/55 line-through"><Money amount={subtotal} currency={booking.currency} /></p> : null}
                {discount > 0 ? <p className="text-xs text-line">Promo −<Money amount={discount} currency={booking.currency} /></p> : null}
                {pointsUsed > 0 ? <p className="text-xs text-line">{pointsUsed} pts used</p> : null}
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-2 space-y-1 text-xs text-mist/65">
          {tab === "upcoming" && booking.canCancel && booking.status !== "waitlist" ? (
            freeUntil.getTime() > Date.now() ? (
              <p className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-line" aria-hidden="true" />Free cancellation until {formatVenueDateTime(freeUntil.toISOString(), booking.timeZone)}</p>
            ) : booking.wasPaid && lateFee > 0 ? (
              <p className="flex items-center gap-1.5 text-amber-200/90"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Cancelling now keeps {lateFee}% of the card payment{social ? "" : ". Points you used come back in full"}.</p>
            ) : null
          ) : null}
          {tab === "past" && (booking.pointsEarned ?? 0) > 0 ? (
            <p className="flex items-center gap-1.5 text-line"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />+{booking.pointsEarned} reward points earned</p>
          ) : null}
          {tab === "cancelled" ? (
            <>
              {booking.status === "expired" ? (
                <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />The hold ended before payment, so nothing was charged.</p>
              ) : booking.cancelledAt ? (
                <p className="flex items-center gap-1.5"><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Cancelled {formatVenueDateTime(booking.cancelledAt, booking.timeZone)}</p>
              ) : null}
              {booking.status === "cancelled" ? (
                booking.wasPaid ? (
                  <p className="flex items-center gap-1.5 text-sky-200"><Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Refunded <Money amount={refund} currency={booking.currency} />{fee > 0 ? ` · ${fee}% late-cancel fee kept` : " · full refund"}
                  </p>
                ) : booking.wasPaid === false ? (
                  <p className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Not charged</p>
                ) : null
              ) : null}
              {pointsUsed > 0 && (!social || fee === 0) ? (
                <p className="flex items-center gap-1.5 text-line"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{pointsUsed} points returned to your balance</p>
              ) : null}
            </>
          ) : null}
          {booking.bookedAt ? <p>Booked {formatVenueDateTime(booking.bookedAt, booking.timeZone)}</p> : null}
        </div>
      </div>
    </div>
  );
}
