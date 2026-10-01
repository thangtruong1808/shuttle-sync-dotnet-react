import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CourtImage, EmptyState, ErrorState, formatVenueRange, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { PickerInput, Skeleton } from "../../components/ui";
import { venueAvailability, type Availability } from "../venues/venueApi";
import { DayChart, SessionClock, upcomingBookings, useNow } from "./CourtSchedule";

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
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const now = useNow();

  useEffect(() => {
    if (!slug || !date) {
      return;
    }
    setLoading(true);
    setError(null);
    venueAvailability(slug, date, from, to)
      .then(setAvailability)
      .catch(() => setError("Courts could not be loaded."))
      .finally(() => {
        setLoading(false);
        setRetrying(false);
      });
  }, [slug, date, from, to, attempt]);

  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white">On the courts</h1>
        <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
          <label className="text-sm">
            <span className="mb-1 block text-mist/70">Date</span>
            <PickerInput
              type="date"
              value={date}
              onChange={(event) => setParams({ date: event.target.value, from, to })}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-mist/70">From</span>
            <PickerInput type="time" value={from} onChange={(event) => setParams({ date, from: event.target.value, to })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-mist/70">To</span>
            <PickerInput type="time" value={to} onChange={(event) => setParams({ date, from, to: event.target.value })} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5" />
          </label>
        </form>
        {loading ? (
          <div className="mt-6 space-y-3" aria-busy="true">
            <span className="sr-only">Loading courts</span>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
        ) : availability && availability.courts.length > 0 ? (
          <>
            <DayChart schedule={availability} now={now} />
            <ul className="mt-6 space-y-4">
              {availability.courts.map((court) => {
                const bookings = upcomingBookings(court.bookings, now);
                return (
                <li key={court.id} className="rounded-3xl border border-white/10 p-4 sm:grid sm:grid-cols-[16rem_1fr] sm:gap-4">
                  <CourtImage src={court.imageUrl} alt={`${court.courtName} court`} />
                  <div>
                    <h2 className="font-display text-2xl text-white">{court.courtName}</h2>
                    <p className="text-sm text-mist/65">Court {court.courtNumber}{court.surfaceType ? ` · ${court.surfaceType}` : ""}</p>
                    {bookings.length === 0 ? <p className="mt-3 text-sm text-mist/65">Nothing else is booked today.</p> : (
                      <ul className="mt-3 grid gap-2">
                        {bookings.map((booking) => (
                          <li key={booking.id} className="rounded-2xl border border-white/10 px-3 py-2">
                            <p className="text-sm text-white">{formatVenueRange(booking.startTime, booking.endTime, availability.venue.timeZone)}</p>
                            <SessionClock start={booking.startTime} end={booking.endTime} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="mt-6"><EmptyState title="No courts on this day" body="Change the date or look at another venue." /></div>
        )}
      </PageSection>
    </main>
  );
}
