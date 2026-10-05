import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, venueToday } from "../../components/format";
import { useVenues } from "../../components/layout/SiteLayout";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { AuthRequestError } from "../auth/authApi";
import { openCourtHold, payNowHold, rememberVenueSlug, venueAvailability, type AvailableCourt } from "../venues/venueApi";

function startsWithin24Hours(date: string, time: string, timeZone: string) {
  if (!date || !time) return false;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return false;
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
  const untilStart = utc - Date.now();
  return untilStart > 0 && untilStart <= 24 * 60 * 60 * 1000;
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
  const [loading, setLoading] = useState(false);
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

  const rate = venue?.hourlyRate ?? 0;
  const currency = venue?.currency ?? "AUD";
  const each = sessionAmount(form.start, form.end, rate);
  const payAtRegistration = startsWithin24Hours(date, form.start, venue?.timeZone ?? "Australia/Melbourne");

  async function onContinue(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (payAtRegistration) {
        let heldGroupId: string | undefined;
        if (form.weeks > 1) {
          const opened = await openCourtHold(slug, form.courtIds, date, form.start, form.end, form.weeks, form.repeat);
          heldGroupId = opened.groupId;
          sessionStorage.setItem("shuttle-sync-held-note", "The other weeks are held. Pay each one from My bookings before 24 hours of that session.");
        }
        const result = await payNowHold(slug, form.courtIds, date, form.start, form.end, form.repeat, form.weeks, heldGroupId);
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
      setFormError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This slot is not available." : "This slot is not available.");
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
                        onChange={() => setForm({
                          ...form,
                          courtIds: checked ? form.courtIds.filter((id) => id !== court.id) : [...form.courtIds, court.id],
                        })}
                      />
                      <span className="truncate">{court.courtName}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="text-sm">
              <span className="mb-1 flex items-center gap-2 text-mist/70">Date {loading ? <Spinner className="h-3.5 w-3.5" /> : null}</span>
              <PickerInput type="date" required value={date} disabled={busy || loading} onChange={(event) => setDate(event.target.value)} iconClassName="text-[#102117]" className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">Start</span>
              <PickerInput type="time" required value={form.start} disabled={busy} onChange={(event) => setForm({ ...form, start: event.target.value })} iconClassName="text-[#102117]" className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">End</span>
              <PickerInput type="time" required value={form.end} disabled={busy} onChange={(event) => setForm({ ...form, end: event.target.value })} iconClassName="text-[#102117]" className="w-full rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
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
                      Total for every selected court and week: <Money amount={each * form.courtIds.length * form.weeks} currency={currency} />
                    </p>
                    <p className="mt-1">You do not pay every later week now. Each of those weeks is held until 24 hours before it starts. {payAtRegistration ? "The first week starts within 24 hours, so it is not held. Pay for that week now or those courts stay open." : "Pay each week before 24 hours of that session, or those courts are released."}</p>
                  </>
                )}
              </div>
              <Button type="submit" className="w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={busy} disabled={busy || loading || form.courtIds.length === 0 || !date || !form.start || !form.end}>
                {payAtRegistration ? "Pay this week now" : "Continue"}
              </Button>
            </div>
            {error ? <div className="sm:col-span-2 xl:col-span-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div> : null}
            {formError ? <p className="text-sm text-mist sm:col-span-2 xl:col-span-4" role="alert">{formError}</p> : null}
          </form>
        )}
      </div>
    </main>
  );
}
