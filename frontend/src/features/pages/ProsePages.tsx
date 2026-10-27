import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageSection } from "../../components/layout/SiteLayout";
import { PageHeader } from "../../components/ui";

function ProseLayout({ title, lede, toc, children }: { title: string; lede: string; toc: { id: string; label: string }[]; children: ReactNode }) {
  return (
    <main>
      <PageSection>
        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,42rem)] lg:gap-12">
          <nav aria-label="On this page" className="mb-8 hidden lg:block">
            <div className="sticky top-24">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-muted">On this page</p>
              <ul className="mt-3 space-y-2 text-sm">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="text-fg-muted hover:text-fg">{item.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
          <article>
            <PageHeader title={title} description={lede} />
            <div className="space-y-10 text-[15px] leading-7 text-fg/85">{children}</div>
          </article>
        </div>
      </PageSection>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-display text-xl font-semibold text-fg">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function CancellationPage() {
  return (
    <ProseLayout
      title="Cancellation policy"
      lede="You can cancel a court booking, a public social, a friend spot, or a waitlist place before the session starts. The refund depends on how close you are to the start time."
      toc={[
        { id: "before-24-hours", label: "More than 24 hours" },
        { id: "within-24-hours", label: "Within 24 hours" },
        { id: "courts-socials-friends", label: "Courts, socials, and friends" },
        { id: "waitlist", label: "Waitlist" },
      ]}
    >
      <Section id="before-24-hours" title="More than 24 hours before the start">
        <p>The card payment for that place is refunded in full. Every reward point you used on it comes back to your available balance.</p>
        <p>The incentive for that place is not added, because you will not be playing.</p>
      </Section>
      <Section id="within-24-hours" title="Within 24 hours of the start">
        <p>After the card payment has succeeded, the venue keeps its late-cancel percent of that charge and refunds the rest.</p>
        <p>Court bookings: every point you used comes back in full. Public socials and friends: the same percent of the points you used is kept, and the rest comes back.</p>
        <p>Example: you used 100 points on a public social and the venue fee is 20%. 80 points return. On a court booking, all 100 return. If the card payment never succeeded, every held point returns.</p>
        <p>Each venue's percent is listed on the <Link to="/promotions" className="font-semibold text-accent-text hover:underline">Promotions</Link> page.</p>
      </Section>
      <Section id="courts-socials-friends" title="Courts, socials, and friends">
        <p>Cancel a court or your own social from My bookings. Cancel a friend from Friend spots. You can change a friend's name until the social starts.</p>
        <p>An unpaid court hold is released 24 hours before that session if it has not been paid. Paying before then keeps the court. Cancelling the hold early frees the court without a charge.</p>
        <p>Cancelling one friend refunds only that friend's share. The other friends, and your own place, stay.</p>
        <p>Cancelling your own social does not cancel your friends. Their places stay paid and seated. Courts are packed again so earlier courts fill first.</p>
        <p>If you paid for several socials together, cancelling one returns that session's share. The others stay registered.</p>
      </Section>
      <Section id="waitlist" title="Waitlist">
        <p>Leaving the waitlist before the session starts uses the same 24-hour rule as a court or a social.</p>
        <p>If the session starts before a place opens, the waitlist payment and the points used on it are refunded in full, even inside 24 hours. The incentive is not added.</p>
        <p>If a place opens in time, you are moved into the social. After that, cancelling follows the normal social rules.</p>
      </Section>
    </ProseLayout>
  );
}

export function TermsPage() {
  return (
    <ProseLayout
      title="Terms"
      lede="These terms describe how booking a court, joining a public social, and using reward points work on Shuttle Sync. The price and time you confirm are the ones stored for that session."
      toc={[
        { id: "your-account", label: "Your account" },
        { id: "courts", label: "Courts" },
        { id: "public-socials", label: "Public socials" },
        { id: "payments", label: "Payments, points, and cancellations" },
      ]}
    >
      <Section id="your-account" title="Your account">
        <p>Sign in to book a court, join a public social, add friends, or spend points. You are responsible for the bookings made from your account.</p>
        <p>Keep your display name suitable to show to other players. It can appear on a public social court list.</p>
      </Section>
      <Section id="courts" title="Courts">
        <p>Booking a court reserves that court for the time you chose, once payment succeeds or the price is covered by points.</p>
        <p>A court with no bookings listed for the day is available. Booked times are shown on that court. A slot can also be unavailable when the venue is closed.</p>
      </Section>
      <Section id="public-socials" title="Public socials">
        <p>A public social sells places, not a private court. The venue sets how many players sit on each court and how many courts the session may use. Places fill court 1 first.</p>
        <p>A waitlist place is not a seat. It becomes a seat only if someone leaves before the session starts. Friends are extra paid places that you add to your registration.</p>
      </Section>
      <Section id="payments" title="Payments, points, and cancellations">
        <p>You pay the amount shown after any promotion code and reward points. Card payments are taken through Stripe. A checkout that is not finished holds the place for a short time, then releases it.</p>
        <p>Available points can be spent at checkout. Pending incentive points are added only after you play and the session ends. Cancelling follows the <Link to="/cancellation" className="font-semibold text-accent-text hover:underline">cancellation policy</Link>.</p>
      </Section>
    </ProseLayout>
  );
}

export function PrivacyPage() {
  return (
    <ProseLayout
      title="Privacy"
      lede="We use your account to run bookings, public socials, and reward points. We do not sell your personal information."
      toc={[
        { id: "what-we-keep", label: "What we keep" },
        { id: "your-session", label: "Your session" },
        { id: "other-players", label: "What other players can see" },
        { id: "payments", label: "Payments" },
      ]}
    >
      <Section id="what-we-keep" title="What we keep">
        <p>Your account can include your name, email, mobile number, and photo. Bookings, public social registrations, friend names you enter, payments, and reward points are stored with that account.</p>
        <p>If you sign in with Google or GitHub, we receive the name and email those services share with us.</p>
      </Section>
      <Section id="your-session" title="Your session">
        <p>Sign-in stays in secure cookies on this device. You can sign out, or sign out other devices, from Security in your profile.</p>
        <p>Profile details, payments, and your own bookings are visible to your signed-in account.</p>
      </Section>
      <Section id="other-players" title="What other players can see">
        <p>A public social is shared. Your display name can be shown on the court you are registered for, and in the session list, so players can see who is coming.</p>
        <p>Friend names you enter are shown with that social in the same way. Email, mobile number, and payment details are not shown to other players.</p>
      </Section>
      <Section id="payments" title="Payments">
        <p>Card payments are processed by Stripe. We store the payment status and amount for your booking. We do not store your full card number.</p>
        <p>Use the phone or email in the footer if you need help with the venue you selected.</p>
      </Section>
    </ProseLayout>
  );
}
