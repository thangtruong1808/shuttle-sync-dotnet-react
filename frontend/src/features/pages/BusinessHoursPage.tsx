import { useEffect, useState } from "react";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { Card, PageHeader, Skeleton } from "../../components/ui";
import { venueHours, type PublicClosure, type Venue } from "../venues/venueApi";

type VenueHours = {
  venue: Venue;
  closures: PublicClosure[];
};

export function BusinessHoursPage() {
  const { venues, error: venueError, retrying: venueRetrying, reload } = useVenues();
  const [rows, setRows] = useState<VenueHours[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!venues) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all(venues.map(async (venue) => ({ venue, closures: await venueHours(venue.slug) })))
      .then((next) => {
        if (active) setRows(next);
      })
      .catch(() => {
        if (active) setError("Business hours could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [venues, attempt]);

  return (
    <main>
      <PageSection>
        <PageHeader
          title="Business hours"
          description="These are the closures set for each venue. A daily closure repeats the same hours every day. Outside those times, courts stay open for booking."
        />
        {venueError ? (
          <div className="max-w-xl"><ErrorState message={venueError} loading={venueRetrying} onRetry={reload} /></div>
        ) : error ? (
          <div className="max-w-xl"><ErrorState message={error} loading={loading} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : venues === null || rows === null || loading ? (
          <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading business hours</span>
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No venues yet" body="Business hours appear here after a venue is added." />
        ) : (
          <div className="grid gap-8">
            {rows.map(({ venue, closures }) => (
              <section key={venue.id} className="grid gap-4">
                {rows.length > 1 ? <h2 className="font-display text-xl font-semibold text-fg">{venue.name}</h2> : null}
                {closures.length === 0 ? (
                  <Card title={venue.name} description="No closures are set. Courts follow the normal booking hours." />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {closures.map((closure) => (
                      <Card key={closure.id} title={closure.courtName} description={closure.reason || "Closed"}>
                        <p className="text-sm leading-relaxed text-fg/80">{closureWhen(closure, venue.timeZone)}</p>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </PageSection>
    </main>
  );
}

function closureWhen(row: PublicClosure, timeZone: string): string {
  const hours = formatVenueRange(row.startTime, row.endTime, timeZone);
  if (row.repeatsDaily) {
    const from = row.fromDate ? prettyDay(row.fromDate) : formatVenueDateTime(row.startTime, timeZone);
    const until = row.untilDate ? ` until ${prettyDay(row.untilDate)}` : "";
    return `Every day from ${from}${until}, ${hours}.`;
  }
  return `${formatVenueDateTime(row.startTime, timeZone)} – ${formatVenueDateTime(row.endTime, timeZone)}.`;
}

function prettyDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}
