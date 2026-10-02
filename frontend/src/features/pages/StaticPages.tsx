import { Link } from "react-router-dom";
import { PageSection } from "../../components/layout/SiteLayout";

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

export function RewardsPage() {
  return (
    <StaticPage title="Rewards">
      Play a session that the venue marked with an incentive. When that session ends, the points land on your profile. Sessions without an incentive do not change your balance.
    </StaticPage>
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
