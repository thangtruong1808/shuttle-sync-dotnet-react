import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock, CreditCard, Eye, UserPlus, X } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { useVenues } from "../../components/layout/SiteLayout";
import { addHoldCourts, venueAvailability, venueForPage } from "../venues/venueApi";
import { AuthRequestError } from "../auth/authApi";
import { cancelBooking, deleteSeries, deleteUnpaidHold, moveCourtSessions, myBookings, myCourtWeeks, refreshUnpaidHolds, setCourtRepeat, type BookingRow, type CancelResult, type CourtWeekCourt, type Page } from "./profileApi";

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
  const [when, setWhen] = useState({ date: openedAt.date, start: openedAt.time, end: closedAt.time });
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionWhen, setSessionWhen] = useState(when);
  const locked = saving || loadingCourts || moving || deleting;
  const held = new Set(courts.map((court) => court.courtId));
  const removed = courts.filter((court) => !checked.has(court.courtId));
  const added = [...checked].filter((id) => !held.has(id));
  const selected = courts.filter((court) => checked.has(court.courtId));
  const total = selected.reduce((sum, court) => sum + court.price, 0) + added.length * first.price;
  const dirty = removed.length > 0 || added.length > 0;
  const pending = selected.filter((court) => court.status === "pending");
  const options = choices ?? courts.map((court) => ({ id: court.courtId, name: court.courtName }));

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
                  disabled={locked}
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
                <span className="min-w-0">{court.name}</span>
                <span className="ml-auto text-xs text-mist/60">{row ? (row.status === "confirmed" ? "Paid" : "Held") : "Add"}</span>
              </label>
              {row ? (
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-line hover:underline disabled:opacity-60"
                  disabled={locked}
                  onClick={() => {
                    const clock = venueFields(row.startTime, row.timeZone);
                    const finish = venueFields(row.endTime, row.timeZone);
                    setSessionId(row.bookingId);
                    setSessionWhen({ date: clock.date, start: clock.time, end: finish.time });
                    setError(null);
                  }}
                >
                  Edit time
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-mist/75">Untick a court to drop it. The total follows the courts you leave ticked.</p>
      {confirmPaid ? <p className="mt-2 text-sm text-mist" role="status">Paid courts you untick are cancelled under the cancellation policy.</p> : null}
      {confirmDelete ? <p className="mt-2 text-sm text-mist" role="status">Delete this week? Unpaid courts are released. A paid court is cancelled under the cancellation policy. Keep weeks ahead is turned off so this week is not added back.</p> : null}
      {error ? <p className="mt-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-100" role="alert">{error}</p> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-sm text-mist">
          <span className="mb-1 block text-mist/70">Date</span>
          <PickerInput type="date" required value={when.date} disabled={locked} onChange={(event) => { setError(null); setWhen({ ...when, date: event.target.value }); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block text-mist/70">Start</span>
          <PickerInput type="time" required value={when.start} disabled={locked} onChange={(event) => { setError(null); setWhen({ ...when, start: event.target.value }); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
        <label className="text-sm text-mist">
          <span className="mb-1 block text-mist/70">End</span>
          <PickerInput type="time" required value={when.end} disabled={locked} onChange={(event) => { setError(null); setWhen({ ...when, end: event.target.value }); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
        </label>
      </div>
      <p className="mt-2 text-sm text-mist/75">Save this time for every court in the week. A court that is already booked or closed stays where it is, and the reason is shown here.</p>
      {sessionId ? (
        <div className="mt-3 rounded-xl border border-white/10 p-3">
          <p className="text-sm font-medium text-white">Edit {courts.find((court) => court.bookingId === sessionId)?.courtName}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <PickerInput type="date" required aria-label="Session date" value={sessionWhen.date} disabled={locked} onChange={(event) => { setError(null); setSessionWhen({ ...sessionWhen, date: event.target.value }); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
            <PickerInput type="time" required aria-label="Session start" value={sessionWhen.start} disabled={locked} onChange={(event) => { setError(null); setSessionWhen({ ...sessionWhen, start: event.target.value }); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
            <PickerInput type="time" required aria-label="Session end" value={sessionWhen.end} disabled={locked} onChange={(event) => { setError(null); setSessionWhen({ ...sessionWhen, end: event.target.value }); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-white [color-scheme:dark]" />
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button type="button" className="w-full sm:w-auto" loading={moving} disabled={locked && !moving} onClick={() => void saveTime(sessionId, sessionWhen)}>Save this court</Button>
            <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={locked} onClick={() => setSessionId(null)}>Close</Button>
          </div>
        </div>
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" className="w-full sm:w-auto" loading={moving} disabled={locked && !moving} onClick={() => void saveTime()}>Save this time</Button>
        <Button type="button" variant="danger" className="w-full sm:w-auto" loading={deleting} disabled={locked && !deleting} onClick={() => void removeWeek()}>{confirmDelete ? "Confirm delete" : "Delete this week"}</Button>
        {choices === null ? (
          <Button type="button" variant="secondary" className="w-full sm:w-auto" loading={loadingCourts} disabled={locked && !loadingCourts} onClick={() => void loadCourts()}>Add another court</Button>
        ) : null}
        {dirty ? (
          <Button type="button" className="w-full sm:w-auto" loading={saving} disabled={locked && !saving} onClick={() => void save()}>{confirmPaid ? "Confirm update" : "Update this week"}</Button>
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

  async function removeSeries() {
    if (!confirmSeries) {
      setConfirmSeries(true);
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
      {confirmSeries && !seriesBusy ? <p className="mt-3 text-sm text-mist" role="status">Delete every week in this booking? Unpaid courts are released. Paid courts are cancelled under the cancellation policy. Keep weeks ahead is turned off, so no week is added back.</p> : null}
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
  const [data, setData] = useState<Page<BookingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMove, setPageMove] = useState<"prev" | "next" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<CourtWeekCourt[][] | null>(null);
  const [holdFilter, setHoldFilter] = useState<(typeof holdFilters)[number]["id"]>("all");
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myBookings(tab, page, venueSlug)
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
  }, [tab, page, attempt, dispatch, venueSlug]);

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

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <h1 className="font-display text-3xl text-white">My bookings</h1>
      {venueName ? <p className="mt-1 text-sm leading-relaxed text-mist/75">Showing bookings at <span className="font-semibold text-white">{venueName}</span>. Choose another venue in the menu above to see its bookings.</p> : null}
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
          <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Court hold view">
            {holdFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={holdFilter === item.id}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${holdFilter === item.id ? "bg-line text-ink" : "border border-white/10 text-mist hover:bg-white/10"}`}
                onClick={() => setHoldFilter(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {visibleSeries(weeks, holdFilter).length === 0 ? (
            <p className="mt-4 text-sm text-mist">No court holds match this view.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {visibleSeries(weeks, holdFilter).map((group) => (
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
          )}
        </>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {data.items.map((booking) => (
            <li key={booking.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{booking.venueName}</p>
                  <p className="text-sm text-mist/70">{booking.status === "waitlist" ? "Waitlist · waiting for a place" : `${booking.courtName} · Court ${booking.courtNumber}`}</p>
                  <p className="text-sm text-mist/70">{formatVenueDateTime(booking.startTime, booking.timeZone)}</p>
                  <p className="text-sm text-mist/70">{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</p>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-white/10 px-2 py-1 text-xs uppercase tracking-wide text-mist">{booking.status}</span>
                  <p className="mt-2 font-semibold text-white"><Money amount={booking.totalAmount} currency={booking.currency} /></p>
                </div>
              </div>
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
          ))}
        </ul>
      ) : tab === "upcoming" && weeks && weeks.length > 0 ? null : (
        <div className="mt-4"><EmptyState title="No bookings here" body={venueName ? `Courts you book at ${venueName} will show up in this list.` : "Courts you book will show up in this list."} /></div>
      )}
        </>
      )}
      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "prev"} disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPageMove("prev"); setPage((value) => value - 1); }}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "next"} disabled={page >= pages || loading} onClick={() => { setLoading(true); setPageMove("next"); setPage((value) => value + 1); }}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}
