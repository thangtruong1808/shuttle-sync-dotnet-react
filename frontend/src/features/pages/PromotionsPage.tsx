import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageSection, useVenues } from "../../components/layout/SiteLayout";
import { ErrorState, Money, venueToday } from "../../components/format";
import { Badge, Card, PageHeader, Skeleton } from "../../components/ui";
import { venueAvailability, venuePromotions, type Promotion, type Venue, type VenueIncentive } from "../venues/venueApi";

type VenueOffers = {
  venue: Venue;
  codes: Promotion[];
  incentives: VenueIncentive[];
};

export function PromotionsPage() {
  const { venues, error: venueError, retrying: venueRetrying, reload, defaultSlug } = useVenues();
  const [selectedSlug, setSelectedSlug] = useState("");
  const [cache, setCache] = useState<Record<string, VenueOffers>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const activeSlug = selectedSlug || defaultSlug || venues?.[0]?.slug || "";
  const activeVenue = venues?.find((venue) => venue.slug === activeSlug) ?? venues?.[0] ?? null;

  useEffect(() => {
    if (!activeVenue) return;
    if (cache[activeVenue.slug] && attempt === 0) return;
    let active = true;
    setLoading(true);
    setError(null);
    Promise.all([
      venuePromotions(activeVenue.slug),
      venueAvailability(activeVenue.slug, venueToday(activeVenue.timeZone), "", ""),
    ])
      .then(([codes, day]) => {
        if (!active) return;
        setCache((current) => ({
          ...current,
          [activeVenue.slug]: {
            venue: activeVenue,
            codes,
            incentives: day.incentives ?? [],
          },
        }));
      })
      .catch(() => {
        if (active) setError("Promotions could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeVenue, attempt]);

  const currentOffers = activeVenue ? cache[activeVenue.slug] ?? null : null;
  const shared = currentOffers ? currentOffers.codes.filter((code) => !code.venueId) : [];
  const own = currentOffers ? currentOffers.codes.filter((code) => Boolean(code.venueId)) : [];

  return (
    <main>
      <PageSection>
        <PageHeader title="Promotions" description="Promotion codes lower the price of a court or a public social. Incentive points are the bonus a venue offers for playing on certain dates. Copy a code and apply it on the pay page." />
        {venues && venues.length > 1 ? (
          <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface-2 p-1" aria-label="Select venue">
            {venues.map((venue) => {
              const isSelected = activeVenue?.slug === venue.slug;
              return (
                <button
                  key={venue.id}
                  type="button"
                  aria-pressed={isSelected}
                  className={`min-h-11 shrink-0 rounded-lg px-3 py-2 text-sm transition ${isSelected ? "bg-surface font-medium text-fg shadow-card" : "text-fg-muted hover:text-fg"}`}
                  onClick={() => {
                    setSelectedSlug(venue.slug);
                    setError(null);
                  }}
                >
                  {venue.name}
                </button>
              );
            })}
          </nav>
        ) : null}
        {venueError ? (
          <div className="max-w-xl"><ErrorState message={venueError} loading={venueRetrying} onRetry={reload} /></div>
        ) : error ? (
          <div className="max-w-xl">
            <ErrorState
              message={error}
              loading={loading}
              onRetry={() => {
                if (activeVenue) {
                  setCache((current) => {
                    const next = { ...current };
                    delete next[activeVenue.slug];
                    return next;
                  });
                }
                setAttempt((value) => value + 1);
              }}
            />
          </div>
        ) : venues === null || (activeVenue !== null && (loading || currentOffers === null)) ? (
          <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading promotions</span>
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : !activeVenue || !currentOffers ? (
          <p className="text-sm text-fg-muted">No venues are open right now.</p>
        ) : (
          <div className="grid gap-4">
            {shared.length > 0 ? (
              <Card title="Every venue" description="These codes work at any venue.">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {shared.map((code) => (
                    <CodeCard key={code.id} code={code} currency={currentOffers.venue.currency ?? "AUD"} />
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card
              title={currentOffers.venue.name}
              description={`${currentOffers.venue.pointsPerDollar} points = ${currentOffers.venue.currency} 1 · late cancel ${Number(currentOffers.venue.lateCancelFeePercent.toFixed(2))}%`}
              actions={<Link to={`/${currentOffers.venue.slug}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline">View courts</Link>}
            >
              <h3 className="text-sm font-semibold text-fg">Promotion codes</h3>
              {own.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">{shared.length > 0 ? "No code just for this venue. Codes in Every venue still apply." : "No promotion code for this venue right now."}</p>
              ) : (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {own.map((code) => (
                    <CodeCard key={code.id} code={code} currency={currentOffers.venue.currency} />
                  ))}
                </ul>
              )}
              <h3 className="mt-5 text-sm font-semibold text-fg">Incentive points</h3>
              {currentOffers.incentives.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">No incentive points on today's date.</p>
              ) : (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {currentOffers.incentives.map((incentive) => (
                    <li key={incentive.id} className="rounded-2xl border border-border bg-surface-2 px-3 py-2.5">
                      <Badge tone="accent">+{incentive.points} pts</Badge>
                      <p className="mt-1 text-sm text-fg-muted">{incentive.startsOn} to {incentive.endsOn}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </PageSection>
    </main>
  );
}

function CodeCard({ code, currency }: { code: Promotion; currency: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-accent-text/25 bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-all font-semibold tracking-wide text-fg">{code.code}</p>
        <p className="text-sm text-accent-text">
          {code.discountType === "percent" ? `${code.discountValue}% off` : <Money amount={code.discountValue} currency={currency} />}
        </p>
      </div>
      <button
        type="button"
        className="min-h-11 w-full shrink-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-fg transition hover:bg-canvas sm:w-auto"
        onClick={() => {
          void navigator.clipboard.writeText(code.code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </button>
    </li>
  );
}
