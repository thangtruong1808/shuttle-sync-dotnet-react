import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageSection } from "../../components/layout/SiteLayout";
import { ErrorState, Money, venueToday } from "../../components/format";
import { Skeleton } from "../../components/ui";
import { listVenues, venueAvailability, venuePromotions, type Promotion, type Venue, type VenueIncentive } from "../venues/venueApi";

function StaticPage({ title, children }: { title: string; children: string }) {
  return (
    <main>
      <PageSection>
        <article className="max-w-2xl">
          <h1 className="font-display text-3xl text-white">{title}</h1>
          <p className="mt-4 leading-relaxed text-mist/75">{children}</p>
        </article>
      </PageSection>
    </main>
  );
}

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
        <h1 className="font-display text-3xl text-white">Promotions</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist/75">Promotion codes lower the price of a court or a public social. Incentive points are the bonus a venue offers for playing on certain dates. Copy a code and apply it on the pay page.</p>
        {error ? (
          <div className="mt-6 max-w-xl"><ErrorState message={error} loading={loading} onRetry={() => setAttempt((value) => value + 1)} /></div>
        ) : loading || rows === null ? (
          <div className="mt-6 grid gap-4 lg:grid-cols-2" aria-busy="true">
            <span className="sr-only">Loading promotions</span>
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {shared.length > 0 ? (
              <section className="rounded-3xl border border-white/10 bg-pine/80 p-5" aria-labelledby="shared-codes">
                <h2 id="shared-codes" className="font-display text-2xl text-white">Every venue</h2>
                <p className="mt-1 text-sm text-mist/70">These codes work at any venue.</p>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {shared.map((code) => (
                    <CodeCard key={code.id} code={code} currency={rows[0]?.venue.currency ?? "AUD"} />
                  ))}
                </ul>
              </section>
            ) : null}
            {rows.length === 0 ? (
              <p className="text-sm text-mist/70">No venues are open right now.</p>
            ) : (
              <ul className="grid gap-4 lg:grid-cols-2">
                {rows.map((row) => {
                  const own = row.codes.filter((code) => code.venueId);
                  return (
                    <li key={row.venue.id} className="rounded-3xl border border-white/10 bg-pine/80 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="font-display text-2xl text-white">{row.venue.name}</h2>
                          <p className="mt-1 text-sm text-mist/70">{row.venue.pointsPerDollar} points = {row.venue.currency} 1 · late cancel {Number(row.venue.lateCancelFeePercent.toFixed(2))}% </p>
                        </div>
                        <Link to={`/${row.venue.slug}`} className="text-sm font-semibold text-line hover:underline">View courts</Link>
                      </div>
                      <h3 className="mt-5 text-sm font-semibold text-white">Promotion codes</h3>
                      {own.length === 0 ? (
                        <p className="mt-2 text-sm text-mist/70">{shared.length > 0 ? "No code just for this venue. Codes in Every venue still apply." : "No promotion code for this venue right now."}</p>
                      ) : (
                        <ul className="mt-2 grid gap-2">
                          {own.map((code) => (
                            <CodeCard key={code.id} code={code} currency={row.venue.currency} />
                          ))}
                        </ul>
                      )}
                      <h3 className="mt-5 text-sm font-semibold text-white">Incentive points</h3>
                      {row.incentives.length === 0 ? (
                        <p className="mt-2 text-sm text-mist/70">No incentive points on today's date.</p>
                      ) : (
                        <ul className="mt-2 grid gap-2">
                          {row.incentives.map((incentive) => (
                            <li key={incentive.id} className="rounded-2xl border border-line/30 bg-line/10 px-3 py-2.5">
                              <p className="font-semibold text-line">+{incentive.points} pts</p>
                              <p className="text-sm text-mist/80">{incentive.startsOn} to {incentive.endsOn}</p>
                            </li>
                          ))}
                        </ul>
                      )}
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
    <li className="flex flex-col gap-2 rounded-2xl border border-line/25 bg-black/25 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="break-all font-semibold tracking-wide text-white">{code.code}</p>
        <p className="text-sm text-line">
          {code.discountType === "percent" ? `${code.discountValue}% off` : <Money amount={code.discountValue} currency={currency} />}
        </p>
      </div>
      <button
        type="button"
        className="w-full rounded-lg border border-white/15 px-3 py-1.5 text-sm font-semibold text-mist hover:bg-white/10 sm:w-auto"
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

export function RewardsPage() {
  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white">Reward points</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-mist/75">Points lower what you pay now, and a finished public social can add more points for next time. Your balance is in the navbar and on your profile.</p>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-pine/80 p-5">
            <h2 className="font-display text-2xl text-white">How you earn points</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-mist/75">
              <li>A venue sets incentive points for a range of dates. Each court shows +N pts and those dates.</li>
              <li>Register for a public social that starts on one of those dates. The pay page shows how many points that social will add.</li>
              <li>After that social ends, the points are added to your balance once. You can spend them on a later court or social.</li>
              <li>A weekly social earns the points again only after that week's session ends, and only if the date is still inside the incentive.</li>
              <li>You do not earn the incentive if you cancel, or if the payment never finishes.</li>
            </ul>
          </article>
          <article className="rounded-3xl border border-white/10 bg-pine/80 p-5">
            <h2 className="font-display text-2xl text-white">How you spend points</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-mist/75">
              <li>On the pay page, use 25%, 50%, 75%, or 100% of the points that fit the price, or move the slider.</li>
              <li>The venue sets the rate. It is shown on the pay page, for example 100 points = $1.</li>
              <li>Points come off the price after any promotion code. The cash left is either $0 or at least $0.50.</li>
              <li>A promotion code and points can be used on a court booking and on a public social.</li>
            </ul>
          </article>
          <article className="rounded-3xl border border-white/10 bg-pine/80 p-5">
            <h2 className="font-display text-2xl text-white">If you cancel a court</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-mist/75">
              <li>You can cancel before the session starts. After it has started, the booking stays.</li>
              <li>More than 24 hours before the start, the card payment is refunded in full and every point you used comes back.</li>
              <li>Within 24 hours, after the card payment has succeeded, the venue keeps its late-cancel percent of the charge. The same percent of the points you used is kept, and the rest comes back. With 100 points and a 20% fee, 80 points return.</li>
              <li>If the card payment never succeeded, cancelling returns every point that was held.</li>
            </ul>
          </article>
          <article className="rounded-3xl border border-white/10 bg-pine/80 p-5">
            <h2 className="font-display text-2xl text-white">If you cancel a public social</h2>
            <ul className="mt-3 space-y-3 text-sm leading-relaxed text-mist/75">
              <li>The same 24-hour rule applies. Cancel from My bookings before the social starts.</li>
              <li>More than 24 hours before the start, that social's card payment is refunded in full and the points used on it come back.</li>
              <li>Within 24 hours, after the card payment has succeeded, the venue keeps its late-cancel percent of that social's charge and the same percent of the points used on it.</li>
              <li>If you paid for several socials together, cancelling one returns that session's share. The others stay registered.</li>
              <li>Cancelling does not award the incentive. Those points arrive only if you are still registered when the social ends.</li>
            </ul>
          </article>
          <article className="rounded-3xl border border-white/10 bg-pine/80 p-5 lg:col-span-2">
            <h2 className="font-display text-2xl text-white">If the payment does not finish</h2>
            <p className="mt-3 text-sm leading-relaxed text-mist/75">Leave Stripe, let the 30-minute hold expire, or have the card payment fail, and the seat is released. Every point taken for that hold comes back. No incentive is added. You can register again when you are ready.</p>
            <p className="mt-3 text-sm text-mist/75">The late-cancel percent for each venue is on the <Link to="/promotions" className="font-semibold text-line hover:underline">Promotions</Link> page.</p>
          </article>
        </div>
      </PageSection>
    </main>
  );
}

export function FaqPage() {
  return (
    <StaticPage title="FAQ">
      A slot is free when the court and venue are open, the start time is still ahead, nobody holds an active booking, and the court is not closed. Pending holds that have expired do not block the slot.
    </StaticPage>
  );
}

export function ContactPage() {
  return (
    <StaticPage title="Contact">
      Use the phone or email in the footer for the venue you selected. Those details come from that venue's record.
    </StaticPage>
  );
}

export function CancellationPage() {
  return (
    <StaticPage title="Cancellation policy">
      You can cancel a pending or confirmed booking before the session starts. More than 24 hours before the start, the payment is refunded in full, including any reward points used. Within 24 hours, the venue keeps the late-cancel percent set in the dashboard and refunds the rest. The same percent of points used is kept.
    </StaticPage>
  );
}

export function TermsPage() {
  return <StaticPage title="Terms">Booking a court reserves that slot for you. The price you are shown is the price stored for the session.</StaticPage>;
}

export function PrivacyPage() {
  return <StaticPage title="Privacy">Your session stays in secure cookies. Profile details are visible only to your signed-in account.</StaticPage>;
}

export function NotFoundPage() {
  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white">Page not found</h1>
        <Link to="/" className="mt-4 inline-block text-line hover:underline">Back home</Link>
      </PageSection>
    </main>
  );
}
