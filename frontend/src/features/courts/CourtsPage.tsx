import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { EmptyState, ErrorState, venueToday } from "../../components/format";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { controlClass, Field, PageHeader, PickerInput, Skeleton } from "../../components/ui";
import { venueAvailability, type Availability } from "../venues/venueApi";
import { BookedTime, DayChart, IncentiveNote, SessionClock, SocialTimes, upcomingBookings, useNow } from "./CourtSchedule";
import { CourtCard } from "./CourtCard";

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
        <PageHeader title="On the courts" description="A court with no bookings is available. Booked times are shown on that court." />
        <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => event.preventDefault()}>
          <Field label="Date">
            {({ id }) => (
              <PickerInput id={id} type="date" value={date} onChange={(event) => setParams({ date: event.target.value, from, to })} className={controlClass} />
            )}
          </Field>
          <Field label="From">
            {({ id }) => (
              <PickerInput id={id} type="time" value={from} onChange={(event) => setParams({ date, from: event.target.value, to })} className={controlClass} />
            )}
          </Field>
          <Field label="To">
            {({ id }) => (
              <PickerInput id={id} type="time" value={to} onChange={(event) => setParams({ date, from, to: event.target.value })} className={controlClass} />
            )}
          </Field>
        </form>
        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading courts</span>
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : error ? (
          <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
        ) : availability && availability.courts.length > 0 ? (
          <>
            <DayChart schedule={availability} now={now} />
            {(availability.incentives ?? []).length > 0 ? (
              <div className="mt-6">
                {(availability.incentives ?? []).map((incentive) => (
                  <IncentiveNote key={incentive.id} points={incentive.points} startsOn={incentive.startsOn} endsOn={incentive.endsOn} />
                ))}
              </div>
            ) : null}
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {availability.courts.map((court) => {
                const bookings = upcomingBookings(court.bookings, now);
                return (
                  <li key={court.id}>
                    <CourtCard
                      name={court.courtName}
                      number={court.courtNumber}
                      surface={court.surfaceType}
                      imageUrl={court.imageUrl}
                      currency={availability.venue.currency}
                      hourlyRate={availability.venue.hourlyRate}
                      heading="h2"
                    >
                      {bookings.length === 0 ? null : (
                        <ul className="mt-3 grid gap-2">
                          {bookings.map((booking) => (
                            <li key={booking.id} className="rounded-2xl border border-border bg-surface-2 px-3 py-2">
                              <BookedTime start={booking.startTime} end={booking.endTime} timeZone={availability.venue.timeZone} />
                              <SessionClock start={booking.startTime} end={booking.endTime} />
                            </li>
                          ))}
                        </ul>
                      )}
                      <SocialTimes times={court.socials ?? []} timeZone={availability.venue.timeZone} now={now} />
                    </CourtCard>
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
