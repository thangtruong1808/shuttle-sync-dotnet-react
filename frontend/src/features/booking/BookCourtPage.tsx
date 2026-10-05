import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, venueToday } from "../../components/format";
import { useVenues } from "../../components/layout/SiteLayout";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { AuthRequestError } from "../auth/authApi";
import { openPlayerSession, rememberVenueSlug, venueAvailability, type AvailableCourt } from "../venues/venueApi";

function hourlyPreview(start: string, end: string, rate: number, currency: string) {
  if (!start || !end || rate <= 0) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (!Number.isFinite(minutes) || minutes < 30) return null;
  const amount = Math.round((rate * minutes) / 60 * 100) / 100;
  return `About ${currency} $${amount.toFixed(2)} before points or a promotion code.`;
}

export default function BookCourtPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSelector((state: RootState) => state.auth.status);
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const [date, setDate] = useState("");
  const [form, setForm] = useState({ courtId: "", start: "", end: "" });
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
          courtId: next.courts.some((court) => court.id === current.courtId) ? current.courtId : "",
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

  async function onContinue(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const opened = await openPlayerSession(slug, form.courtId, date, form.start, form.end);
      navigate(`/${slug}/book/${opened.sessionId}`);
    } catch (reason) {
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
          <p className="mt-2 text-sm leading-relaxed text-mist/75">Choose a court and a time. You can use a promotion code and reward points on the next page.</p>
        </div>
        {status === "unknown" || (!date && !venue) ? (
          <div aria-busy="true">
            <span className="sr-only">Loading booking form</span>
            <Skeleton className="h-28" />
          </div>
        ) : (
          <form className="grid gap-3 rounded-3xl border border-white/10 bg-pine/80 p-4 sm:grid-cols-2 xl:grid-cols-4" onSubmit={onContinue}>
            <label className="text-sm sm:col-span-2 xl:col-span-1">
              <span className="mb-1 block text-mist/70">Court</span>
              <select
                required
                value={form.courtId}
                disabled={busy || loading}
                className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist disabled:opacity-60"
                onChange={(event) => setForm({ ...form, courtId: event.target.value })}
              >
                <option value="">Choose a court</option>
                {(courts ?? []).map((court) => (
                  <option key={court.id} value={court.id}>{court.courtName}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 flex items-center gap-2 text-mist/70">Date {loading ? <Spinner className="h-3.5 w-3.5" /> : null}</span>
              <PickerInput type="date" required value={date} disabled={busy || loading} onChange={(event) => setDate(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">Start</span>
              <PickerInput type="time" required value={form.start} disabled={busy} onChange={(event) => setForm({ ...form, start: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">End</span>
              <PickerInput type="time" required value={form.end} disabled={busy} onChange={(event) => setForm({ ...form, end: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between xl:col-span-4">
              <p className="text-sm text-mist/75">
                {hourlyPreview(form.start, form.end, rate, currency) ?? "At least 30 minutes. The price uses the court hourly rate."}
                {rate > 0 ? <> · <Money amount={rate} currency={currency} /> / hour</> : null}
              </p>
              <Button type="submit" className="w-full sm:w-auto" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />} loading={busy} disabled={busy || loading || !form.courtId || !date || !form.start || !form.end}>
                Continue
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
