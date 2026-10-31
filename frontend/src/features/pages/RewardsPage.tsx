import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageSection } from "../../components/layout/SiteLayout";
import { Card, PageHeader } from "../../components/ui";

function GuideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title}>
      <div className="space-y-3 text-sm leading-relaxed text-fg/80">{children}</div>
    </Card>
  );
}

export function RewardsPage() {
  return (
    <main>
      <PageSection>
        <PageHeader
          title="Reward points"
          description="Points can lower what you pay today. A finished court, public social, or friend spot can add more points after that session ends. Available points are ready to spend. Pending points are waiting for the session to finish."
        />
        <div className="grid gap-4 md:grid-cols-2">
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
            <p>Venue staff and admins can also award recommendation bonus points directly to your balance for community contributions and fair play.</p>
          </GuideCard>
          <GuideCard title="How you spend points">
            <p>On the pay page, choose 25%, 50%, 75%, or 100% of the points that fit the price, or move the slider.</p>
            <p>The venue sets the rate, shown on the pay page. For example, 100 points = $1.</p>
            <p>A promotion code is applied first. Points come off what is left. The cash to pay is either $0 or at least $0.50.</p>
            <p>You can use a code and points on a court, a public social, a waitlist place, and friends.</p>
          </GuideCard>
          <GuideCard title="If you cancel or the payment stops">
            <p>Cancel before the session starts from My bookings or Friend spots. The <Link to="/cancellation" className="font-semibold text-accent-text hover:underline">cancellation policy</Link> says when the card refund is full and when the venue keeps a late-cancel share. Points you spent on a court booking always come back in full. Points spent on a public social or friend follow that same share.</p>
            <p>Leaving Stripe, letting the 30-minute hold expire, or a failed card payment releases the place. Points held for that checkout come back. No incentive is added.</p>
            <p>Each venue's late-cancel percent is on the <Link to="/promotions" className="font-semibold text-accent-text hover:underline">Promotions</Link> page.</p>
          </GuideCard>
        </div>
      </PageSection>
    </main>
  );
}
