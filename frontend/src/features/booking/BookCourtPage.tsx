import { type FormEvent, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { ErrorState, Money, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
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
    <main>
      <PageSection>
        <Link to={`/${slug}`} className="text-sm text-line hover:underline">Back to the venue</Link>
        <h1 className="mt-3 font-display text-3xl text-white">Book a court</h1>
        <p className="mt-2 max-w-xl text-sm text-mist/75">Choose a court and a time. You can use a promotion code and reward points on the next page.</p>
        {status === "unknown" || (!date && !venue) ? (
          <div className="mt-6 space-y-2" aria-busy="true">
            <span className="sr-only">Loading booking form</span>
            <Skeleton className="h-24" />
          </div>
        ) : (
          <form className="mt-6 grid max-w-xl gap-3 rounded-3xl border border-white/10 bg-pine/80 p-6 sm:grid-cols-2" onSubmit={onContinue}>
            <label className="text-sm sm:col-span-2">
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
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-mist/70">Start</span>
                <PickerInput type="time" required value={form.start} disabled={busy} onChange={(event) => setForm({ ...form, start: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-mist/70">End</span>
                <PickerInput type="time" required value={form.end} disabled={busy} onChange={(event) => setForm({ ...form, end: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-mist/75">
                {hourlyPreview(form.start, form.end, rate, currency) ?? "At least 30 minutes. The price uses the court hourly rate."}
                {rate > 0 ? <> · <Money amount={rate} currency={currency} /> / hour</> : null}
              </p>
              <Button type="submit" className="w-full sm:w-auto" loading={busy} disabled={busy || loading || !form.courtId || !date || !form.start || !form.end}>
                Continue
              </Button>
            </div>
            {error ? <div className="sm:col-span-2"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div> : null}
            {formError ? <p className="text-sm text-mist sm:col-span-2" role="alert">{formError}</p> : null}
          </form>
        )}
      </PageSection>
    </main>
  );
}
