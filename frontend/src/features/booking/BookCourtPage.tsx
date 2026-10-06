import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, CircleAlert } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, formatVenueDateTime, venueToday } from "../../components/format";
import { useVenues } from "../../components/layout/SiteLayout";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { AuthRequestError } from "../auth/authApi";
import { courtPrice, openCourtHold, payNowHold, rememberVenueSlug, venueAvailability, type AvailableCourt, type ScheduleClosure } from "../venues/venueApi";

function venueInstant(date: string, time: string, timeZone: string) {
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return null;
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  const target = utc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Australia/Melbourne",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const shown = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"));
    utc += target - shown;
  }
  return utc;
}

function startsWithin24Hours(date: string, time: string, timeZone: string) {
  const utc = venueInstant(date, time, timeZone);
  if (utc === null) return false;
  const untilStart = utc - Date.now();
  return untilStart > 0 && untilStart <= 24 * 60 * 60 * 1000;
}

function overlaps(start: number, end: number, otherStart: string, otherEnd: string) {
  const from = new Date(otherStart).getTime();
  const to = new Date(otherEnd).getTime();
  return Number.isFinite(from) && Number.isFinite(to) && start < to && end > from;
}

function unavailableReason(courts: AvailableCourt[], closures: ScheduleClosure[], courtIds: string[], date: string, start: string, end: string, timeZone: string) {
  const startMs = venueInstant(date, start, timeZone);
  const endMs = venueInstant(date, end, timeZone);
  if (startMs === null || endMs === null) return null;
  if (endMs <= startMs) return "The end time needs to be later than the start time.";
  if (endMs - startMs < 30 * 60 * 1000) return "Choose at least 30 minutes between the start and the end.";
  if (startMs <= Date.now()) return "That time has already started. Choose a later time.";
  const chosen = courts.filter((court) => courtIds.includes(court.id));
  const booked = chosen.flatMap((court) => court.bookings.filter((booking) => overlaps(startMs, endMs, booking.startTime, booking.endTime)).map((booking) => ({ court, booking })));
  if (booked.length > 0) {
    const first = booked[0];
    const from = formatVenueDateTime(first.booking.startTime, timeZone);
    const to = formatVenueDateTime(first.booking.endTime, timeZone);
    const extra = booked.length > 1 ? ` ${booked.length - 1} other selected ${booked.length === 2 ? "court is" : "courts are"} busy then too.` : "";
    if (first.booking.status === "pending") {
      return `${first.court.courtName} is already in a booking from ${from} to ${to}, and the payment is not finished.${extra} Complete the payment or delete it in My bookings.`;
    }
    return `${first.court.courtName} is already booked from ${from} to ${to}.${extra} Choose another time or another court.`;
  }
  const closed = closures.find((closure) => (closure.courtId === null || courtIds.includes(closure.courtId)) && overlaps(startMs, endMs, closure.startTime, closure.endTime));
  if (closed) {
    const name = closed.courtId ? chosen.find((court) => court.id === closed.courtId)?.courtName ?? "That court" : "This venue";
    return `${name} is closed from ${formatVenueDateTime(closed.startTime, timeZone)} to ${formatVenueDateTime(closed.endTime, timeZone)}. Choose another time.`;
  }
  return null;
}

function shownHoldError(message: string | undefined) {
  if (!message || message === "The request could not be completed.") {
    return "That date and time is not available for the courts you chose. It may already be booked or closed. Choose another time.";
  }
  return message;
}

function sessionAmount(start: string, end: string, rate: number) {
  if (!start || !end || rate <= 0) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (!Number.isFinite(minutes) || minutes < 30) return null;
  return Math.round((rate * minutes) / 60 * 100) / 100;
}

export default function BookCourtPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSelector((state: RootState) => state.auth.status);
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const [date, setDate] = useState("");
  const [form, setForm] = useState({ courtIds: [] as string[], start: "", end: "", weeks: 1, repeat: false });
  const [courts, setCourts] = useState<AvailableCourt[] | null>(null);
  const [closures, setClosures] = useState<ScheduleClosure[]>([]);
  const [loading, setLoading] = useState(false);
  const [quoted, setQuoted] = useState<number | null>(null);
  const [scheduledRate, setScheduledRate] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (venue) {
      setDate((current) => current || venueToday(venue.timeZone));
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || !date) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    venueAvailability(slug, date, "", "")
      .then((next) => {
        if (controller.signal.aborted) return;
        setCourts(next.courts);
        setClosures(next.closures ?? []);
        setForm((current) => ({
          ...current,
          courtIds: current.courtIds.filter((id) => next.courts.some((court) => court.id === id)),
        }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Courts could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, date, attempt]);

  if (status === "anonymous") {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }

  useEffect(() => {
    if (!slug || !date || !form.start || !form.end) {
      setQuoted(null);
      setScheduledRate(false);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    courtPrice(slug, date, form.start, form.end, form.weeks)
      .then((result) => {
        if (controller.signal.aborted) return;
        setQuoted(result.courtAmount);
        setScheduledRate(result.scheduled);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setQuoted(null);
        setScheduledRate(false);
      })
      .finally(() => {
        if (!controller.signal.aborted) setQuoting(false);
      });
    return () => controller.abort();
  }, [slug, date, form.start, form.end, form.weeks]);

  const rate = venue?.hourlyRate ?? 0;
  const currency = venue?.currency ?? "AUD";
  const flat = sessionAmount(form.start, form.end, rate);
  const each = quoted ?? (flat === null ? null : flat * form.weeks);
  const payAtRegistration = startsWithin24Hours(date, form.start, venue?.timeZone ?? "Australia/Melbourne");

  async function onContinue(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const blocked = unavailableReason(courts ?? [], closures, form.courtIds, date, form.start, form.end, venue?.timeZone ?? "Australia/Melbourne");
    if (blocked) {
      setFormError(blocked);
      return;
    }
    setBusy(true);
    try {
      if (payAtRegistration) {
        const result = await payNowHold(slug, form.courtIds, date, form.start, form.end, form.repeat, form.weeks);
        sessionStorage.setItem("shuttle-sync-checkout", result.bookingId);
        if (result.checkoutUrl) {
          window.location.assign(result.checkoutUrl);
          return;
        }
        navigate(`/${slug}/book/group/${result.groupId}?checkout=success`);
        return;
      }
      const opened = await openCourtHold(slug, form.courtIds, date, form.start, form.end, form.weeks, form.repeat);
      navigate(`/${slug}/book/group/${opened.groupId}`);
    } catch (reason) {
      sessionStorage.removeItem("shuttle-sync-held-note");
      setFormError(shownHoldError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="w-full px-4 py-4 sm:px-6 lg:px-8">
      <Link to={`/${slug}`} className="text-sm text-line hover:underline">Back to the venue</Link>
      <div className="mt-3 grid items-start gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div>
          <h1 className="font-display text-3xl text-white">Book a court</h1>
          <p className="mt-2 text-sm leading-relaxed text-mist/75">Choose the courts and the time you want each week. A week that starts in more than 24 hours can be held, and you pay it before that session. A week that starts within 24 hours is not saved unless you pay for it now.</p>
        </div>
        {status === "unknown" || (!date && !venue) ? (
          <div aria-busy="true">
            <span className="sr-only">Loading booking form</span>
            <Skeleton className="h-28" />
          </div>
        ) : (
          <form className="grid gap-3 rounded-3xl border border-white/10 bg-pine/80 p-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={onContinue}>
            <fieldset className="min-w-0 sm:col-span-2 xl:col-span-4">
              <legend className="mb-2 text-sm text-mist/70">Courts</legend>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-3">
                {(courts ?? []).map((court) => {
                  const checked = form.courtIds.includes(court.id);
                  return (
                    <label key={court.id} className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${checked ? "border-line/50 bg-line/10 text-white" : "border-white/10 bg-black/30 text-mist"}`}>
                      <input
                        type="checkbox"
                        className="accent-line"
                        checked={checked}
                        disabled={busy || loading}
                        onChange={() => {
                          setFormError(null);
                          setForm({
                            ...form,
                            courtIds: checked ? form.courtIds.filter((id) => id !== court.id) : [...form.courtIds, court.id],
                          });
                        }}
                      />
                      <span className="truncate">{court.courtName}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="text-sm">
              <span className="mb-1 flex items-center gap-2 text-mist/70">Date {loading ? <Spinner className="h-3.5 w-3.5" /> : null}</span>
              <PickerInput type="date" required value={date} disabled={busy || loading} onChange={(event) => { setFormError(null); setDate(event.target.value); }} iconClassName="text-[#102117]" className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">Start</span>
              <PickerInput type="time" required value={form.start} disabled={busy} onChange={(event) => { setFormError(null); setForm({ ...form, start: event.target.value }); }} iconClassName="text-[#102117]" className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">End</span>
              <PickerInput type="time" required value={form.end} disabled={busy} onChange={(event) => { setFormError(null); setForm({ ...form, end: event.target.value }); }} iconClassName="text-[#102117]" className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">Weeks</span>
              <select
                value={form.weeks}
                disabled={busy}
                className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light] disabled:opacity-60"
                onChange={(event) => setForm({ ...form, weeks: Number(event.target.value) })}
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((weeks) => (
                  <option key={weeks} value={weeks} className="bg-[#f4fbf6] text-[#102117]">{weeks === 1 ? "This week only" : `${weeks} weeks`}</option>
                ))}
              </select>
            </label>
            {formError ? (
              <p className="flex items-start gap-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium leading-relaxed text-rose-100 sm:col-span-2 xl:col-span-4" role="alert">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" aria-hidden="true" />
                <span>{formError}</span>
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-sm text-mist sm:col-span-2 xl:col-span-4">
              <input
                type="checkbox"
                className="mt-1 accent-line"
                checked={form.repeat}
                disabled={busy}
                onChange={(event) => setForm({ ...form, repeat: event.target.checked })}
              />
              <span>Keep {form.weeks} {form.weeks === 1 ? "week" : "weeks"} ahead. When one week passes, the next week is held automatically. You still pay each week before 24 hours of that session.</span>
            </label>
            <div className="flex flex-col gap-3 sm:col-span-2 xl:col-span-4">
              <div className="text-sm leading-relaxed text-mist/75">
                {each === null || form.courtIds.length === 0 ? (
                  <p>Choose at least 30 minutes and one court. You can hold the same time for up to 12 weeks.</p>
                ) : (
                  <>
                    <p className="font-semibold text-white">
                      Total for every selected court and week: <Money amount={each * form.courtIds.length} currency={currency} />
                    </p>
                    <p className="mt-1">You do not pay every later week now. Each of those weeks is held until 24 hours before it starts. {scheduledRate ? "This total uses the venue rate for the days and hours you chose. " : ""}{payAtRegistration ? "The first week starts within 24 hours, so it is not held. Pay for that week now or those courts stay open." : "Pay each week before 24 hours of that session, or those courts are released."} {quoting ? <Spinner className="inline h-3.5 w-3.5" /> : null}</p>
                  </>
                )}
              </div>
              <Button type="submit" className="w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={busy} disabled={busy || loading || quoting || form.courtIds.length === 0 || !date || !form.start || !form.end}>
                {payAtRegistration ? "Pay this week now" : "Continue"}
              </Button>
            </div>
            {error ? <div className="sm:col-span-2 xl:col-span-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div> : null}
          </form>
        )}
      </div>
    </main>
  );
}
