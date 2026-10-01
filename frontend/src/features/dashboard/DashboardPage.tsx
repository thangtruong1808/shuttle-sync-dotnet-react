import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState } from "../../components/format";
import { Skeleton } from "../../components/ui";
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
      <h1 className="font-display text-3xl text-white">Overview</h1>
      <p className="mt-2 text-sm text-mist/70">Venues and courts you can manage.</p>
      {error ? (
        <div className="mt-6">
          <ErrorState
            message={error}
            loading={retrying}
            onRetry={() => {
              setRetrying(true);
              setAttempt((value) => value + 1);
            }}
          />
        </div>
      ) : counts === null || venues === null ? (
        <div className="mt-6" aria-busy="true">
          <span className="sr-only">Loading overview</span>
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 px-4 py-3">
              <dt className="text-sm text-mist/65">Venues</dt>
              <dd className="font-display text-3xl text-white">{counts.venues}</dd>
            </div>
            <div className="rounded-2xl border border-white/10 px-4 py-3">
              <dt className="text-sm text-mist/65">Courts</dt>
              <dd className="font-display text-3xl text-white">{counts.courts}</dd>
            </div>
          </dl>
          {venues.length === 0 ? (
            <div className="mt-6">
              <EmptyState title="No venues to show" body="Assigned venues will appear here." />
            </div>
          ) : (
            <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {venues.map((venue) => (
                <li key={venue.id}>
                  <Link to={`/dashboard/venues/${venue.id}`} className="block rounded-2xl border border-white/10 p-4 hover:bg-white/5">
                    <p className="font-medium text-white">{venue.name}</p>
                    <p className="text-sm text-mist/65">{[venue.suburb, venue.state].filter(Boolean).join(", ") || venue.slug}</p>
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
