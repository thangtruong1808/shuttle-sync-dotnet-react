import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { CourtImage, EmptyState, ErrorState, Money, addDays, formatVenueRange, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import {
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
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [promotions, setPromotions] = useState<Promotion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (venue) {
      setDate((current) => current || venueToday(venue.timeZone));
      rememberVenueSlug(venue.slug);
    }
  }, [venue]);

  useEffect(() => {
    if (!slug || !date) {
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    Promise.all([venueAvailability(slug, date, from, to), venuePromotions(slug)])
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
        }
      });
    return () => controller.abort();
  }, [slug, date, from, to, attempt]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    navigate(`/${slug}/courts?date=${date}&from=${from}&to=${to}`);
  }

  if (venues && !venue) {
    return (
      <PageSection>
        <EmptyState title="Venue not found" body="Choose another venue from the menu." />
      </PageSection>
    );
  }

  const others = (venues ?? []).filter((item) => item.slug !== slug);
  const nextDay = date ? addDays(date, 1) : "";

  return (
    <main>
      <PageSection>
        <section className="rounded-3xl border border-white/10 bg-pine/90 p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-line">Badminton booking</p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Find a court at {venue?.name ?? "your venue"}.
          </h1>
          <p className="mt-3 max-w-xl text-mist/75">Pick a day, filter the time, and hold a slot. Prices and points come from the venue.</p>
          <form className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={onSearch}>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">Date</span>
              <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">From</span>
              <input type="time" value={from} onChange={(event) => setFrom(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-mist/70">To</span>
              <input type="time" value={to} onChange={(event) => setTo(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-mist" />
            </label>
            <div className="flex items-end">
              <Button type="submit" className="w-full">Find courts</Button>
            </div>
          </form>
        </section>

        <section className="mt-10" aria-labelledby="available-courts">
          <h2 id="available-courts" className="font-display text-2xl font-semibold text-white">Available courts</h2>
          {venueError ? <div className="mt-4"><ErrorState message={venueError} onRetry={reload} /></div> : null}
          {loading ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              <span className="sr-only">Loading courts</span>
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : error ? (
            <div className="mt-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
          ) : availability && availability.courts.length > 0 ? (
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {availability.courts.map((court) => (
                <li key={court.id} className="rounded-3xl border border-white/10 bg-pine/70 p-4">
                  <CourtImage src={court.imageUrl} alt={`${court.courtName} court`} />
                  <h3 className="mt-4 font-display text-xl text-white">{court.courtName}</h3>
                  <p className="text-sm text-mist/65">Court {court.courtNumber}{court.surfaceType ? ` · ${court.surfaceType}` : ""}</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {court.slots.slice(0, 3).map((slot) => (
                      <li key={slot.id}>
                        <Link
                          to={`/${slug}/book/${slot.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm hover:border-line/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
                        >
                          <span>{formatVenueRange(slot.startTime, slot.endTime, availability.venue.timeZone)}</span>
                          <Money amount={slot.price} currency={availability.venue.currency} />
                          {slot.incentivePoints ? <span className="rounded-full bg-line/15 px-1.5 text-xs font-semibold text-line">+{slot.incentivePoints} pts</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-4 space-y-3">
              <EmptyState title="No courts are free" body="Try the next day, widen the time filter, or look at another venue." />
              {nextDay ? (
                <Button variant="secondary" onClick={() => setDate(nextDay)}>See {nextDay}</Button>
              ) : null}
            </div>
          )}
        </section>

        <section id="promotions" className="mt-10 rounded-3xl border border-line/30 bg-line/10 p-5">
          <h2 className="font-display text-2xl text-white">Promotions</h2>
          {promotions && promotions.length > 0 ? (
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {promotions.map((promotion) => (
                <li key={promotion.id} className="flex items-center justify-between gap-3 rounded-2xl bg-ink/50 px-4 py-3">
                  <div>
                    <p className="font-semibold text-white">{promotion.code}</p>
                    <p className="text-sm text-mist/70">
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

        <section className="mt-10 grid gap-4 rounded-3xl border border-white/10 bg-pine/70 p-6 md:grid-cols-[1.4fr_0.6fr] md:items-center">
          <div>
            <h2 className="font-display text-2xl text-white">Play more, earn points</h2>
            <p className="mt-2 text-mist/75">When a court session ends, active incentives add points to your profile. Sessions without an incentive are skipped.</p>
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
              <dd className="mt-1 text-mist/70">After the booked session ends, and only if that session has an active incentive.</dd>
            </div>
            <div>
              <dt className="font-medium text-white">Can I cancel?</dt>
              <dd className="mt-1 text-mist/70">Future pending or confirmed bookings can be cancelled. The refund amount is calculated by the server.</dd>
            </div>
          </dl>
        </section>
      </PageSection>
    </main>
  );
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
