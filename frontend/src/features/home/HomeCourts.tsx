import { ChevronRight } from "lucide-react";
import { Button, Skeleton } from "../../components/ui";
import { EmptyState, ErrorState } from "../../components/format";
import { BookedTime, DayChart, IncentiveNote, SessionClock, SocialTimes, upcomingBookings } from "../courts/CourtSchedule";
import { CourtCard } from "../courts/CourtCard";
import type { Availability } from "../venues/venueApi";

export function HomeCourts({
  availability,
  loading,
  error,
  venueError,
  venueRetrying = false,
  onRetryVenue,
  retrying,
  onRetry,
  nextDay,
  nextLoading,
  nextDisabled,
  onNext,
  now,
}: {
  availability: Availability | null;
  loading: boolean;
  error: string | null;
  venueError: string | null;
  venueRetrying?: boolean;
  onRetryVenue: () => void;
  retrying: boolean;
  onRetry: () => void;
  nextDay: string;
  nextLoading: boolean;
  nextDisabled: boolean;
  onNext: () => void;
  now: number;
}) {
  return (
    <section className="mt-10" aria-labelledby="available-courts">
      <h2 id="available-courts" className="font-display text-2xl text-fg">Courts</h2>
      {venueError ? <div className="mt-4"><ErrorState message={venueError} loading={venueRetrying} onRetry={onRetryVenue} /></div> : null}
      {loading ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          <span className="sr-only">Loading courts</span>
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : error ? (
        <div className="mt-4"><ErrorState message={error} loading={retrying} onRetry={onRetry} /></div>
      ) : availability && availability.courts.length > 0 ? (
        <>
          <DayChart schedule={availability} now={now} compact collapsible />
          {(availability.incentives ?? []).length > 0 ? (
            <div className="mt-4">
              {(availability.incentives ?? []).map((incentive) => (
                <IncentiveNote key={incentive.id} points={incentive.points} startsOn={incentive.startsOn} endsOn={incentive.endsOn} />
              ))}
            </div>
          ) : null}
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                  >
                    {bookings.length === 0 ? null : (
                      <ul className="mt-3 grid grid-cols-2 gap-2">
                        {bookings.map((booking) => (
                          <li key={booking.id} className={`min-w-0 rounded-2xl px-3 py-2 ${booking.status === "pending" ? "border border-amber-300/40 bg-amber-400/10" : "border border-border bg-surface-2"}`}>
                            <BookedTime start={booking.startTime} end={booking.endTime} timeZone={availability.venue.timeZone} unpaid={booking.status === "pending"} />
                            <SessionClock start={booking.startTime} end={booking.endTime} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <SocialTimes times={court.socials ?? []} timeZone={availability.venue.timeZone} now={now} slug={availability.venue.slug} courtNumber={court.courtNumber} />
                  </CourtCard>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="mt-4">
          <EmptyState
            title="No courts on this day"
            body="Try the next day or look at another venue."
            action={nextDay ? (
              <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={nextLoading} disabled={nextDisabled} onClick={onNext}>See {nextDay}</Button>
            ) : undefined}
          />
        </div>
      )}
    </section>
  );
}
