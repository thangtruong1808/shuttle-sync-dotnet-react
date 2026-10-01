import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CourtImage, EmptyState, ErrorState, Money, formatVenueRange, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { Skeleton } from "../../components/ui";
import { venueAvailability, type Availability } from "../venues/venueApi";

export default function CourtsPage() {
  const { slug = "" } = useParams();
  const { venues } = useVenues();
  const venue = venues?.find((item) => item.slug === slug);
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || (venue ? venueToday(venue.timeZone) : "");
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!slug || !date) {
      return;
    }
    setLoading(true);
    setError(null);
    venueAvailability(slug, date, from, to)
      .then(setAvailability)
      .catch(() => setError("Courts could not be loaded."))
      .finally(() => setLoading(false));
  }, [slug, date, from, to, attempt]);

  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white">Courts</h1>
        <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
          <label className="text-sm">
            <span className="mb-1 block text-mist/70">Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setParams({ date: event.target.value, from, to })}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-mist/70">From</span>
            <input type="time" value={from} onChange={(event) => setParams({ date, from: event.target.value, to })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-mist/70">To</span>
            <input type="time" value={to} onChange={(event) => setParams({ date, from, to: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5" />
          </label>
        </form>
        {loading ? (
          <div className="mt-6 space-y-3" aria-busy="true">
            <span className="sr-only">Loading courts</span>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : availability && availability.courts.length > 0 ? (
          <ul className="mt-6 space-y-4">
            {availability.courts.map((court) => (
              <li key={court.id} className="rounded-3xl border border-white/10 p-4 sm:grid sm:grid-cols-[16rem_1fr] sm:gap-4">
                <CourtImage src={court.imageUrl} alt={`${court.courtName} court`} />
                <div>
                  <h2 className="font-display text-2xl text-white">{court.courtName}</h2>
                  <p className="text-sm text-mist/65">Court {court.courtNumber}{court.surfaceType ? ` · ${court.surfaceType}` : ""}</p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {court.slots.map((slot) => (
                      <li key={slot.id}>
                        <Link to={`/${slug}/book/${slot.id}`} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm hover:border-line/40">
                          {formatVenueRange(slot.startTime, slot.endTime, availability.venue.timeZone)}
                          <Money amount={slot.price} currency={availability.venue.currency} />
                          {slot.incentivePoints ? <span className="text-xs font-semibold text-line">+{slot.incentivePoints} pts</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6"><EmptyState title="Nothing is free in this window" body="Change the date or clear the time filter." /></div>
        )}
      </PageSection>
    </main>
  );
}
