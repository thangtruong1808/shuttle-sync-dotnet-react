import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageSection } from "../../components/layout/SiteLayout";
import { ErrorState, Money, venueToday } from "../../components/format";
import { Badge, Card, PageHeader, Skeleton } from "../../components/ui";
import { listVenues, venueAvailability, venuePromotions, type Promotion, type Venue, type VenueIncentive } from "../venues/venueApi";

type VenueOffers = {
  venue: Venue;
  codes: Promotion[];
  incentives: VenueIncentive[];
};

export function PromotionsPage() {
  const [shared, setShared] = useState<Promotion[]>([]);
  const [rows, setRows] = useState<VenueOffers[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listVenues()
      .then(async (venues) => {
        const loaded = await Promise.all(venues.map(async (venue) => {
          const [codes, day] = await Promise.all([
            venuePromotions(venue.slug),
            venueAvailability(venue.slug, venueToday(venue.timeZone), "", ""),
          ]);
          return { venue, codes, incentives: day.incentives ?? [] };
        }));
        if (!active) return;
        const everywhere = new Map<string, Promotion>();
        loaded.forEach((row) => {
          row.codes.filter((code) => !code.venueId).forEach((code) => everywhere.set(code.id, code));
        });
        setShared([...everywhere.values()]);
        setRows(loaded);
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
  }, [attempt]);

  return (
    <main>
      <PageSection>
        <PageHeader title="Promotions" description="Promotion codes lower the price of a court or a public social. Incentive points are the bonus a venue offers for playing on certain dates. Copy a code and apply it on the pay page." />
        {error ? (
          <div className="max-w-xl"><ErrorState message={error} loading={loading} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : loading || rows === null ? (
          <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading promotions</span>
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <div className="grid gap-4">
            {shared.length > 0 ? (
              <Card title="Every venue" description="These codes work at any venue.">
                <ul className="grid gap-2 sm:grid-cols-2">
                  {shared.map((code) => (
                    <CodeCard key={code.id} code={code} currency={rows[0]?.venue.currency ?? "AUD"} />
                  ))}
                </ul>
              </Card>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-fg-muted">No venues are open right now.</p>
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {rows.map((row) => {
                  const own = row.codes.filter((code) => code.venueId);
                  return (
                    <li key={row.venue.id}>
                      <Card
                        title={row.venue.name}
                        description={`${row.venue.pointsPerDollar} points = ${row.venue.currency} 1 · late cancel ${Number(row.venue.lateCancelFeePercent.toFixed(2))}%`}
                        actions={<Link to={`/${row.venue.slug}`} className="text-sm font-semibold text-accent-text hover:underline">View courts</Link>}
                      >
                        <h3 className="text-sm font-semibold text-fg">Promotion codes</h3>
                        {own.length === 0 ? (
                          <p className="mt-2 text-sm text-fg-muted">{shared.length > 0 ? "No code just for this venue. Codes in Every venue still apply." : "No promotion code for this venue right now."}</p>
                        ) : (
                          <ul className="mt-2 grid gap-2">
                            {own.map((code) => (
                              <CodeCard key={code.id} code={code} currency={row.venue.currency} />
                            ))}
                          </ul>
                        )}
                        <h3 className="mt-5 text-sm font-semibold text-fg">Incentive points</h3>
                        {row.incentives.length === 0 ? (
                          <p className="mt-2 text-sm text-fg-muted">No incentive points on today's date.</p>
                        ) : (
                          <ul className="mt-2 grid gap-2">
                            {row.incentives.map((incentive) => (
                              <li key={incentive.id} className="rounded-2xl border border-border bg-surface-2 px-3 py-2.5">
                                <Badge tone="accent">+{incentive.points} pts</Badge>
                                <p className="mt-1 text-sm text-fg-muted">{incentive.startsOn} to {incentive.endsOn}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
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
        className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-fg hover:bg-canvas sm:w-auto"
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
