import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, LayoutGrid } from "lucide-react";
import { EmptyState, ErrorState } from "../../components/format";
import { PageHeader, Skeleton, StatCard } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import { DashError, overview } from "./dashboardApi";

export default function DashboardPage() {
  const [counts, setCounts] = useState<{ venues: number; courts: number } | null>(null);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([overview(), dashboardVenues()])
      .then(([summary, list]) => {
        if (!active) return;
        setCounts(summary);
        setVenues(list);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof DashError ? reason.message : "Dashboard could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <div>
      <PageHeader title="Overview" description="Venues and courts you can manage." />
      {error ? (
        <ErrorState
          message={error}
          loading={retrying}
          onRetry={() => {
            setRetrying(true);
            setAttempt((value) => value + 1);
          }}
        />
      ) : counts === null || venues === null ? (
        <div aria-busy="true">
          <span className="sr-only">Loading overview</span>
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Venues" value={counts.venues} hint="Places you can open from this desk." icon={<Building2 className="h-4 w-4" aria-hidden="true" />} />
            <StatCard label="Courts" value={counts.courts} hint="Courts across those venues." icon={<LayoutGrid className="h-4 w-4" aria-hidden="true" />} />
          </div>
          {venues.length === 0 ? (
            <div className="mt-6">
              <EmptyState title="No venues to show" body="Assigned venues will appear here." />
            </div>
          ) : (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {venues.map((venue) => (
                <li key={venue.id}>
                  <Link to={`/dashboard/venues/${venue.id}`} className="block rounded-2xl border border-border bg-surface p-4 shadow-card hover:bg-surface-2 dark:shadow-none">
                    <p className="break-words font-medium text-fg">{venue.name}</p>
                    <p className="break-words text-sm text-fg-muted">{[venue.suburb, venue.state].filter(Boolean).join(", ") || venue.slug}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
