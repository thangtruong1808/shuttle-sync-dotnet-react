import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { NavLink, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { EmptyState, ErrorState } from "../../components/format";
import { Skeleton } from "../../components/ui";
import { DashError, venueDetail, type DashVenue } from "./dashboardApi";
import { Closures } from "./VenueClosures";
import { Courts } from "./VenueCourts";
import { Details } from "./VenueDetails";
import { Incentives } from "./VenueIncentives";
import { Rates } from "./VenueRates";
import { Slots } from "./VenueSlots";

const sections = ["details", "courts", "slots", "rates", "closures", "incentives"] as const;

export default function VenueDesk() {
  const { venueId = "", section = "details" } = useParams();
  const role = useSelector((state: RootState) => state.auth.user?.role);
  const admin = role === "admin";
  const [venue, setVenue] = useState<DashVenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setVenue(null);
    setError(null);
  }, [venueId]);

  useEffect(() => {
    let active = true;
    venueDetail(venueId)
      .then((row) => {
        if (!active) return;
        setVenue(row);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "That venue could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, venueId]);

  const current = sections.includes(section as (typeof sections)[number]) ? section : "details";

  return (
    <div>
      {error ? (
        <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />
      ) : venue === null ? (
        <div aria-busy="true">
          <span className="sr-only">Loading venue</span>
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <h1 className="font-display text-3xl text-fg">{venue.name}</h1>
          <nav className="mt-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-2 p-1" aria-label="Venue sections">
            {sections
              .filter((item) => (item !== "incentives" && item !== "rates") || admin)
              .map((item) => (
                <NavLink
                  key={item}
                  to={item === "details" ? `/dashboard/venues/${venueId}` : `/dashboard/venues/${venueId}/${item}`}
                  end={item === "details"}
                  className={({ isActive }) => `shrink-0 rounded-lg px-3 py-2 text-sm capitalize ${isActive ? "bg-surface font-medium text-fg shadow-card" : "text-fg-muted hover:text-fg"}`}
                >
                  {item}
                </NavLink>
              ))}
          </nav>
          <div className="mt-6">
            {current === "details" ? <Details venue={venue} admin={admin} onSaved={() => setAttempt((value) => value + 1)} /> : null}
            {current === "courts" ? <Courts venueId={venueId} /> : null}
            {current === "slots" ? <Slots venueId={venueId} currency={venue.currency} timeZone={venue.timeZone} /> : null}
            {current === "rates" && admin ? <Rates venueId={venueId} currency={venue.currency} hourlyRate={venue.hourlyRate} /> : null}
            {current === "rates" && !admin ? <EmptyState title="Admins only" body="Court rates are managed by an admin." /> : null}
            {current === "closures" ? <Closures venueId={venueId} timeZone={venue.timeZone} venueName={venue.name} /> : null}
            {current === "incentives" && admin ? <Incentives venueId={venueId} timeZone={venue.timeZone} /> : null}
            {current === "incentives" && !admin ? <EmptyState title="Admins only" body="Reward incentives are managed by an admin." /> : null}
          </div>
        </>
      )}
    </div>
  );
}
