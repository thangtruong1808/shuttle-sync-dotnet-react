import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import { SlidersHorizontal, Tag, X } from "lucide-react";
import type { RootState } from "../../app/store";
import { Button, PickerInput, Skeleton } from "../../components/ui";
import { CourtImage, EmptyState, ErrorState, Money, addDays, formatVenueRange, venueToday } from "../../components/format";
import { DayChart, OpenSlots, SessionClock, upcomingBookings, useNow } from "../courts/CourtSchedule";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { AuthRequestError } from "../auth/authApi";
import {
  openPlayerSession,
  rememberVenueSlug,
  venueAvailability,
  venuePromotions,
  type Availability,
  type Promotion,
} from "../venues/venueApi";

export default function HomePage() {
  const { slug = "" } = useParams();
  const { venues, error: venueError, reload } = useVenues();
  const user = useSelector((state: RootState) => state.auth.user);
  const status = useSelector((state: RootState) => state.auth.status);
  const venue = venues?.find((item) => item.slug === slug) ?? null;
  const [draft, setDraft] = useState({ date: "", from: "", to: "" });
  const [applied, setApplied] = useState({ date: "", from: "", to: "" });
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "filter" | "clear" | "next">(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookForm, setBookForm] = useState({ courtId: "", date: "", start: "", end: "" });
  const [bookBusy, setBookBusy] = useState(false);
  const [bookError, setBookError] = useState<string | null>(null);
  const navigate = useNavigate();
  const now = useNow();

  useEffect(() => {
    if (venue) {
      const today = venueToday(venue.timeZone);
      setDraft((current) => ({ ...current, date: current.date || today }));
      setApplied((current) => (current.date ? current : { date: today, from: "", to: "" }));
      setBookForm((current) => ({ ...current, date: current.date || today }));
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || !applied.date) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([venueAvailability(slug, applied.date, applied.from, applied.to), venuePromotions(slug)])
      .then(([nextAvailability, nextPromotions]) => {
        if (!controller.signal.aborted) {
          setAvailability(nextAvailability);
          setPromotions(nextPromotions);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Courts could not be loaded.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRetrying(false);
          setBusy(null);
        }
      });
    return () => controller.abort();
  }, [slug, applied, attempt]);

  function onFilter(event: FormEvent) {
    event.preventDefault();
    setBusy("filter");
    setApplied({ date: draft.date, from: draft.from, to: draft.to });
    setAttempt((value) => value + 1);
  }

  async function onBook(event: FormEvent) {
    event.preventDefault();
    if (status !== "authenticated") {
      navigate(`/login?next=${encodeURIComponent(`/${slug}`)}`);
      return;
    }
    setBookError(null);
    setBookBusy(true);
    try {
      const opened = await openPlayerSession(slug, bookForm.courtId, bookForm.date, bookForm.start, bookForm.end);
      navigate(`/${slug}/book/${opened.sessionId}`);
    } catch (reason) {
      setBookError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This slot is not available." : "This slot is not available.");
    } finally {
      setBookBusy(false);
    }
  }

  function onClear() {
    const today = venue ? venueToday(venue.timeZone) : draft.date || applied.date;
    if (!today) {
      return;
    }
    setBusy("clear");
    setDraft({ date: today, from: "", to: "" });
    setApplied({ date: today, from: "", to: "" });
    setAttempt((value) => value + 1);
  }

  if (venues && !venue) {
    return (
      <PageSection>
        <EmptyState title="Venue not found" body="Choose another venue from the menu." />
      </PageSection>
    );
  }

  const others = (venues ?? []).filter((item) => item.slug !== slug);
  const nextDay = applied.date ? addDays(applied.date, 1) : "";
  const today = venue ? venueToday(venue.timeZone) : "";
  const filtered = Boolean(applied.from || applied.to || (today && applied.date && applied.date !== today));

  return (
    <main>
      <PageSection>
        <section className="rounded-3xl border border-white/10 bg-pine/90 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-line">Badminton booking</p>
          <h1 className="mt-3 max-w-4xl font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Find a court at {venue?.name ?? "your venue"}.
          </h1>
          <p className="mt-3 max-w-xl text-mist/75">Pick a day to see who is booked on each court.</p>
          <form className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onFilter}>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">Date</span>
              <PickerInput type="date" required value={draft.date} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">From</span>
              <PickerInput type="time" value={draft.from} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, from: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">To</span>
              <PickerInput type="time" value={draft.to} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" className="w-full sm:w-auto" icon={<SlidersHorizontal className="h-4 w-4" aria-hidden="true" />} loading={busy === "filter"} disabled={!draft.date || (busy !== null && busy !== "filter")}>Filter</Button>
              <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => { setBookingOpen((open) => !open); setBookError(null); }}>Book a court</Button>
              {filtered || busy === "clear" ? (
                <Button type="button" variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={busy === "clear"} disabled={busy !== null && busy !== "clear"} onClick={onClear}>Clear</Button>
              ) : null}
            </div>
          </form>
          {bookingOpen ? (
            <form className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 sm:grid-cols-2" onSubmit={onBook}>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-mist/70">Court</span>
                <select
                  required
                  value={bookForm.courtId}
                  disabled={bookBusy || loading}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist disabled:opacity-60"
                  onChange={(event) => setBookForm({ ...bookForm, courtId: event.target.value })}
                >
                  <option value="">Choose a court</option>
                  {(availability?.courts ?? []).map((court) => (
                    <option key={court.id} value={court.id}>{court.courtName} · Court {court.courtNumber}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-mist/70">Date</span>
                <PickerInput type="date" required value={bookForm.date} disabled={bookBusy} onChange={(event) => setBookForm({ ...bookForm, date: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-mist/70">Start</span>
                  <PickerInput type="time" required value={bookForm.start} disabled={bookBusy} onChange={(event) => setBookForm({ ...bookForm, start: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-mist/70">End</span>
                  <PickerInput type="time" required value={bookForm.end} disabled={bookBusy} onChange={(event) => setBookForm({ ...bookForm, end: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
                </label>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-mist/75">
                  {hourlyPreview(bookForm.start, bookForm.end, venue?.hourlyRate ?? availability?.venue.hourlyRate ?? 0, venue?.currency ?? availability?.venue.currency ?? "AUD") ?? "At least 30 minutes. The price uses the venue hourly rate."}
                </p>
                <Button type="submit" className="w-full sm:w-auto" loading={bookBusy} disabled={bookBusy || !bookForm.courtId || !bookForm.date || !bookForm.start || !bookForm.end}>
                  Continue
                </Button>
              </div>
              {bookError ? <p className="text-sm text-mist sm:col-span-2" role="alert">{bookError}</p> : null}
            </form>
          ) : null}
          <section id="promotions" className="mt-6 border-t border-white/10 pt-5" aria-labelledby="promotions-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="promotions-heading" className="flex items-center gap-2 font-display text-lg text-white">
                <Tag className="h-4 w-4 text-line" aria-hidden="true" />
                Promotions
              </h2>
            </div>
            {promotions && promotions.length > 0 ? (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {promotions.map((promotion) => (
                  <li key={promotion.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line/25 bg-black/25 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="break-all font-semibold tracking-wide text-white">{promotion.code}</p>
                      <p className="text-sm text-line">
                        {promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={venue?.currency ?? "AUD"} />}
                        {promotion.venueId ? "" : " · all venues"}
                      </p>
                    </div>
                    <CopyCode code={promotion.code} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-mist/70">No active promotion codes right now.</p>
            )}
          </section>
        </section>

        <section className="mt-10" aria-labelledby="available-courts">
          {venueError ? <div className="mt-4"><ErrorState message={venueError} onRetry={reload} /></div> : null}
          {loading ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              <span className="sr-only">Loading courts</span>
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : error ? (
            <div className="mt-4"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
          ) : availability && availability.courts.length > 0 ? (
            <>
              <DayChart schedule={availability} now={now} compact />
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {availability.courts.map((court) => {
                  const bookings = upcomingBookings(court.bookings, now);
                  return (
                    <li key={court.id} className="rounded-3xl border border-white/10 bg-pine/70 p-4">
                      <CourtImage src={court.imageUrl} alt={`${court.courtName} court`} />
                      <h3 className="mt-4 font-display text-xl text-white">{court.courtName}</h3>
                      <p className="text-sm text-mist/65">Court {court.courtNumber}{court.surfaceType ? ` · ${court.surfaceType}` : ""}</p>
                      {(availability.incentives ?? []).map((incentive) => (
                        <p key={incentive.id} className="mt-2 text-sm font-semibold text-line">+{incentive.points} pts · {incentive.startsOn} to {incentive.endsOn}</p>
                      ))}
                      {bookings.length === 0 ? <p className="mt-3 text-sm text-mist/65">Nothing else is booked today.</p> : (
                        <ul className="mt-3 grid grid-cols-2 gap-2">
                          {bookings.map((booking) => (
                            <li key={booking.id} className="min-w-0 rounded-2xl border border-white/15 px-3 py-2">
                              <p className="text-sm text-white">{formatVenueRange(booking.startTime, booking.endTime, availability.venue.timeZone)}</p>
                              <SessionClock start={booking.startTime} end={booking.endTime} />
                            </li>
                          ))}
                        </ul>
                      )}
                      <OpenSlots slug={slug} slots={court.slots ?? []} timeZone={availability.venue.timeZone} currency={availability.venue.currency} now={now} />
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="mt-4 space-y-3">
              <EmptyState title="No courts on this day" body="Try the next day or look at another venue." />
              {nextDay ? (
                <Button variant="secondary" loading={busy === "next"} disabled={busy !== null && busy !== "next"} onClick={() => {
                  setDraft((current) => ({ ...current, date: nextDay }));
                  setBusy("next");
                  setApplied((current) => ({ ...current, date: nextDay }));
                  setAttempt((value) => value + 1);
                }}>See {nextDay}</Button>
              ) : null}
            </div>
          )}
        </section>

        <section className="mt-10 grid gap-4 rounded-3xl border border-white/10 bg-pine/70 p-6 md:grid-cols-[1.4fr_0.6fr] md:items-center">
          <div>
            <h2 className="font-display text-2xl text-white">Play more, earn points</h2>
            <p className="mt-2 text-mist/75">Book on a day that shows points on the court. Those points are added after the session ends.</p>
          </div>
          {status === "authenticated" && user ? (
            <p className="text-lg font-semibold text-line">{user.rewardPoints} points</p>
          ) : (
            <Link to="/register" className="inline-flex justify-center rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink">Sign up</Link>
          )}
        </section>

        {others.length > 0 ? (
          <section className="mt-10" aria-labelledby="other-venues">
            <h2 id="other-venues" className="font-display text-2xl text-white">Other venues</h2>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {others.map((item) => (
                <li key={item.id}>
                  <Link to={`/${item.slug}`} className="block rounded-3xl border border-white/10 bg-pine/70 p-4 hover:border-line/40">
                    <CourtImage src={item.imageUrl} alt="" />
                    <p className="mt-3 font-medium text-white">{item.name}</p>
                    <p className="text-sm text-mist/65">{item.suburb ?? "View courts"}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10 grid gap-4 md:grid-cols-3">
          {["Pick a venue", "Choose a slot", "Pay with Stripe"].map((step, index) => (
            <article key={step} className="rounded-2xl border border-white/10 p-4">
              <p className="text-sm font-semibold text-line">Step {index + 1}</p>
              <h2 className="mt-2 font-display text-xl text-white">{step}</h2>
            </article>
          ))}
        </section>

        <section className="mt-10" aria-labelledby="faq">
          <h2 id="faq" className="font-display text-2xl text-white">FAQ</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-white">When do I earn points?</dt>
              <dd className="mt-1 text-mist/70">After the booked session ends, when that day is inside the points range shown on the court.</dd>
            </div>
            <div>
              <dt className="font-medium text-white">Can I cancel?</dt>
              <dd className="mt-1 text-mist/70">You can cancel before the session starts. More than 24 hours before the start, the payment is refunded in full. Within 24 hours, the venue keeps its late-cancel percent and refunds the rest.</dd>
            </div>
          </dl>
        </section>
      </PageSection>
    </main>
  );
}

function hourlyPreview(start: string, end: string, rate: number, currency: string) {
  if (!start || !end || rate <= 0) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (!Number.isFinite(minutes) || minutes < 30) return null;
  const amount = Math.round(rate * minutes / 60 * 100) / 100;
  return `About ${currency} ${amount.toFixed(2)} before points or a promotion code.`;
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rounded-lg border border-white/15 px-3 py-1.5 text-sm font-semibold text-mist hover:bg-white/10"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}
