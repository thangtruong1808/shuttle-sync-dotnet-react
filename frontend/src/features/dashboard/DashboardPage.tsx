import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { CourtImage, EmptyState, ErrorState } from "../../components/format";
import { PageSection } from "../../components/layout/SiteLayout";
import { Skeleton } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";

export default function DashboardPage() {
  const status = useSelector((state: RootState) => state.auth.status);
  const user = useSelector((state: RootState) => state.auth.user);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status !== "authenticated" || (user?.role !== "staff" && user?.role !== "admin")) {
      return;
    }
    setError(null);
    dashboardVenues()
      .then(setVenues)
      .catch(() => setError("Dashboard venues could not be loaded."));
  }, [status, user?.role, attempt]);

  if (status === "unknown") {
    return <PageSection><Skeleton className="h-40" /></PageSection>;
  }
  if (status !== "authenticated" || !user) {
    return <Navigate to="/login?next=/dashboard" replace />;
  }
  if (user.role !== "staff" && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white">Dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-mist/70">
          This view is read-only. {user.role === "staff" ? "Staff can see assigned venues only." : "Admins can see every venue."} Creating or editing courts, sessions, and incentives is not available yet.
        </p>
        {error ? (
          <div className="mt-6"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : venues === null ? (
          <div className="mt-6" aria-busy="true"><span className="sr-only">Loading venues</span><Skeleton className="h-40" /></div>
        ) : venues.length === 0 ? (
          <div className="mt-6"><EmptyState title="No venues to show" body="Assigned venues will appear here." /></div>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {venues.map((venue) => (
              <li key={venue.id} className="rounded-3xl border border-white/10 p-4">
                <CourtImage src={venue.imageUrl} alt="" />
                <h2 className="mt-3 font-display text-xl text-white">{venue.name}</h2>
                <p className="text-sm text-mist/65">{[venue.suburb, venue.state].filter(Boolean).join(", ") || venue.slug}</p>
              </li>
            ))}
          </ul>
        )}
      </PageSection>
    </main>
  );
}
