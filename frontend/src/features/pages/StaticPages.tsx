import { useEffect, useState, type ReactNode } from "react";
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

function Guide({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/75">{lede}</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">{children}</div>
      </PageSection>
    </main>
  );
}

function GuideCard({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <article className={`rounded-3xl border border-white/10 bg-pine/80 p-5 ${wide ? "md:col-span-2" : ""}`}>
      <h2 className="font-display text-2xl text-white">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-mist/80">{children}</div>
    </article>
  );
}

function FaqItem({ question, children }: { question: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-pine/80 px-4 py-3 open:border-line/40">
      <summary className="cursor-pointer list-none font-medium text-white [&::-webkit-details-marker]:hidden">
        <span className="flex items-start justify-between gap-3">
          <span>{question}</span>
          <span className="text-lg leading-none text-line transition group-open:rotate-45" aria-hidden="true">+</span>
        </span>
      </summary>
      <div className="mt-2 text-sm leading-relaxed text-mist/75">{children}</div>
    </details>
  );
}

export function RewardsPage() {
  return (
    <Guide title="Reward points" lede="Points can lower what you pay today. A finished court, public social, or friend spot can add more points after that session ends. Available points are ready to spend. Pending points are waiting for the session to finish.">
      <GuideCard title="Available and pending">
        <p>Your available balance is in the navbar and on your profile. You can spend it on the pay page.</p>
        <p>Pending points are set aside when you book a court, join a public social, or add friends, and an incentive is on for that date. Open Reward points in your profile to see each one. They join your balance after that session ends.</p>
        <p>A cancelled place, a waitlist place that never opens, or a payment that does not finish does not earn the incentive.</p>
      </GuideCard>
      <GuideCard title="How you earn points">
        <p>A venue sets incentive points for a range of dates. Court cards show +N pts and those dates.</p>
        <p>Book a court or register for a public social that starts inside those dates. The pay page tells you how many points that session will add.</p>
        <p>Each confirmed friend earns the same points after the social ends. Three friends at +10 pts add 30 pts, on top of your own place.</p>
        <p>A weekly social earns points again only after that week's session ends, and only while the date is still inside the incentive.</p>
      </GuideCard>
      <GuideCard title="How you spend points">
        <p>On the pay page, choose 25%, 50%, 75%, or 100% of the points that fit the price, or move the slider.</p>
        <p>The venue sets the rate, shown on the pay page. For example, 100 points = $1.</p>
        <p>A promotion code is applied first. Points come off what is left. The cash to pay is either $0 or at least $0.50.</p>
        <p>You can use a code and points on a court, a public social, a waitlist place, and friends.</p>
      </GuideCard>
      <GuideCard title="If you cancel or the payment stops">
        <p>Cancel before the session starts from My bookings or Friend spots. The <Link to="/cancellation" className="font-semibold text-line hover:underline">cancellation policy</Link> says when the card refund is full and when the venue keeps a late-cancel share. Points you already spent follow that same share.</p>
        <p>Leaving Stripe, letting the 30-minute hold expire, or a failed card payment releases the place. Points held for that checkout come back. No incentive is added.</p>
        <p>Each venue's late-cancel percent is on the <Link to="/promotions" className="font-semibold text-line hover:underline">Promotions</Link> page.</p>
      </GuideCard>
    </Guide>
  );
}

export function FaqPage() {
  return (
    <main>
      <PageSection>
        <h1 className="font-display text-3xl text-white sm:text-4xl">FAQ</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/75">Short answers for finding a court, joining a public social, and using reward points. Open a question to read more.</p>
        <div className="mt-6 grid gap-3">
          <FaqItem question="How do I see which courts are free?">
            Choose a day on the venue home page. A court with no bookings listed is available. Booked times appear on that court. You can also narrow the day with From and To.
          </FaqItem>
          <FaqItem question="How do I book a court?">
            Sign in, choose Book a court, then pick the court, date, and time. On the next page you can add a promotion code and reward points before you pay. The price you see is the price for that session.
          </FaqItem>
          <FaqItem question="What is a public social?">
            A public social is a drop-in session. You pay for a place, and the venue assigns courts in order. Court 1 fills first, up to the players per court and the court limit set for that session. The next person uses another court only after the earlier court is full.
          </FaqItem>
          <FaqItem question="What if the social is full?">
            Join the waitlist from Register for public social. You pay first, the same way as a normal place. If someone leaves before the session starts, the first person waiting gets the place. If the session starts while you are still waiting, that payment and any points you used are refunded in full.
          </FaqItem>
          <FaqItem question="Can I bring friends?">
            After your own place is confirmed, use Add friends. You pay for the friends only, not for your place again. Each friend can earn the venue's incentive after the social ends. Their names stay in Friend spots even if you later cancel your own place.
          </FaqItem>
          <FaqItem question="Where do I see who is registered?">
            On the venue home page, View registration on a court shows the display names on that court. On Register for public social, View registration shows everyone in that session. In My bookings, View registration shows your place and your friends.
          </FaqItem>
          <FaqItem question="When do reward points arrive?">
            Points you can spend are available now. Points from a court, public social, or friend are pending until that session ends, then they move to your balance. Open Reward points in your profile to see both. A cancelled place does not earn them.
          </FaqItem>
          <FaqItem question="How do refunds work?">
            Cancel before the session starts. More than 24 hours before the start, the card payment and the points you used come back in full. Within 24 hours, the venue keeps its late-cancel percent of the charge and the same percent of the points used. See the <Link to="/cancellation" className="font-semibold text-line hover:underline">cancellation policy</Link>.
          </FaqItem>
        </div>
      </PageSection>
    </main>
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
    <Guide title="Cancellation policy" lede="You can cancel a court booking, a public social, a friend spot, or a waitlist place before the session starts. The refund depends on how close you are to the start time.">
      <GuideCard title="More than 24 hours before the start">
        <p>The card payment for that place is refunded in full. Every reward point you used on it comes back to your available balance.</p>
        <p>The incentive for that place is not added, because you will not be playing.</p>
      </GuideCard>
      <GuideCard title="Within 24 hours of the start">
        <p>After the card payment has succeeded, the venue keeps its late-cancel percent of that charge and refunds the rest. The same percent of the points you used is kept, and the rest comes back.</p>
        <p>Example: you used 100 points and the venue fee is 20%. 80 points return. If the card payment never succeeded, every held point returns.</p>
        <p>Each venue's percent is listed on the <Link to="/promotions" className="font-semibold text-line hover:underline">Promotions</Link> page.</p>
      </GuideCard>
      <GuideCard title="Courts, socials, and friends">
        <p>Cancel a court or your own social from My bookings. Cancel a friend from Friend spots. You can change a friend's name until the social starts.</p>
        <p>Cancelling one friend refunds only that friend's share. The other friends, and your own place, stay.</p>
        <p>Cancelling your own social does not cancel your friends. Their places stay paid and seated. Courts are packed again so earlier courts fill first.</p>
        <p>If you paid for several socials together, cancelling one returns that session's share. The others stay registered.</p>
      </GuideCard>
      <GuideCard title="Waitlist">
        <p>Leaving the waitlist before the session starts uses the same 24-hour rule as a court or a social.</p>
        <p>If the session starts before a place opens, the waitlist payment and the points used on it are refunded in full, even inside 24 hours. The incentive is not added.</p>
        <p>If a place opens in time, you are moved into the social. After that, cancelling follows the normal social rules.</p>
      </GuideCard>
    </Guide>
  );
}

export function TermsPage() {
  return (
    <Guide title="Terms" lede="These terms describe how booking a court, joining a public social, and using reward points work on Shuttle Sync. The price and time you confirm are the ones stored for that session.">
      <GuideCard title="Your account">
        <p>Sign in to book a court, join a public social, add friends, or spend points. You are responsible for the bookings made from your account.</p>
        <p>Keep your display name suitable to show to other players. It can appear on a public social court list.</p>
      </GuideCard>
      <GuideCard title="Courts">
        <p>Booking a court reserves that court for the time you chose, once payment succeeds or the price is covered by points.</p>
        <p>A court with no bookings listed for the day is available. Booked times are shown on that court. A slot can also be unavailable when the venue is closed.</p>
      </GuideCard>
      <GuideCard title="Public socials">
        <p>A public social sells places, not a private court. The venue sets how many players sit on each court and how many courts the session may use. Places fill court 1 first.</p>
        <p>A waitlist place is not a seat. It becomes a seat only if someone leaves before the session starts. Friends are extra paid places that you add to your registration.</p>
      </GuideCard>
      <GuideCard title="Payments, points, and cancellations" wide>
        <p>You pay the amount shown after any promotion code and reward points. Card payments are taken through Stripe. A checkout that is not finished holds the place for a short time, then releases it.</p>
        <p>Available points can be spent at checkout. Pending incentive points are added only after you play and the session ends. Cancelling follows the <Link to="/cancellation" className="font-semibold text-line hover:underline">cancellation policy</Link>.</p>
      </GuideCard>
    </Guide>
  );
}

export function PrivacyPage() {
  return (
    <Guide title="Privacy" lede="We use your account to run bookings, public socials, and reward points. We do not sell your personal information.">
      <GuideCard title="What we keep">
        <p>Your account can include your name, email, mobile number, and photo. Bookings, public social registrations, friend names you enter, payments, and reward points are stored with that account.</p>
        <p>If you sign in with Google or GitHub, we receive the name and email those services share with us.</p>
      </GuideCard>
      <GuideCard title="Your session">
        <p>Sign-in stays in secure cookies on this device. You can sign out, or sign out other devices, from Security in your profile.</p>
        <p>Profile details, payments, and your own bookings are visible to your signed-in account.</p>
      </GuideCard>
      <GuideCard title="What other players can see">
        <p>A public social is shared. Your display name can be shown on the court you are registered for, and in the session list, so players can see who is coming.</p>
        <p>Friend names you enter are shown with that social in the same way. Email, mobile number, and payment details are not shown to other players.</p>
      </GuideCard>
      <GuideCard title="Payments">
        <p>Card payments are processed by Stripe. We store the payment status and amount for your booking. We do not store your full card number.</p>
        <p>Use the phone or email in the footer if you need help with the venue you selected.</p>
      </GuideCard>
    </Guide>
  );
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
