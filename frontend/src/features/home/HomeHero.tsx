import { Link } from "react-router-dom";
import { CalendarDays, Clock, LayoutGrid, ShieldCheck, Ticket, Users } from "lucide-react";
import { Money } from "../../components/format";
import { buttonClass, StatCard } from "../../components/ui";
import type { Promotion, Venue } from "../venues/venueApi";
import { HomePromos } from "./HomePromos";

export function HomeHero({
  venue,
  slug,
  hasSocials,
  showDefault,
  isDefault,
  onDefault,
  hours,
  courts,
  cancelPercent,
  promotions,
  promotionsLoading,
}: {
  venue: Venue;
  slug: string;
  hasSocials: boolean;
  showDefault: boolean;
  isDefault: boolean;
  onDefault: (checked: boolean) => void;
  hours: string;
  courts: string;
  cancelPercent: string;
  promotions: Promotion[] | null;
  promotionsLoading: boolean;
}) {
  const place = [venue.suburb, venue.state].filter(Boolean).join(", ");
  return (
    <section>
      <div className="relative overflow-hidden rounded-3xl border border-border shadow-card dark:shadow-none">
        <div className="relative min-h-[22rem] sm:min-h-[26rem]">
          {venue.imageUrl ? <img src={venue.imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
          <div className={`absolute inset-0 ${venue.imageUrl ? "bg-gradient-to-t from-[#07140f] via-[#07140f]/80 to-[#07140f]/20" : "bg-gradient-to-br from-[#10261c] via-[#0c1c16] to-[#163528]"}`} />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgb(198_245_78/0.35),transparent_52%)]" />
          <div className="relative flex min-h-[22rem] flex-col justify-end gap-6 p-6 sm:min-h-[26rem] sm:p-10 md:flex-row md:items-end md:justify-between md:gap-6 lg:gap-8">
            <div className="min-w-0 max-w-3xl flex-1">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#c6f54e]">{place || "Badminton booking"}</p>
              <h1 className="mt-2 font-display text-display font-semibold text-white">{venue.name}</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80 sm:text-base">
                {venue.description || "Real-time court availability, weekly holds, and secure Stripe checkout."}
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link to={`/${slug}/book`} className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Book a court
                </Link>
                {hasSocials ? (
                  <Link to={`/${slug}/social`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/50 bg-white/10 px-5 py-3 text-base font-semibold text-white transition hover:bg-white/20 sm:w-auto">
                    <Users className="h-4 w-4" aria-hidden="true" />
                    Join a social
                  </Link>
                ) : null}
              </div>
              {showDefault ? (
                <label className="mt-5 flex max-w-xl items-start gap-2 text-sm text-white/90">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 accent-[#c6f54e]"
                    checked={isDefault}
                    onChange={(event) => onDefault(event.target.checked)}
                  />
                  <span>Use {venue.name} as my default venue. Home, My bookings, and the other pages keep this venue.</span>
                </label>
              ) : null}
            </div>
            <HomePromos promotions={promotions} loading={promotionsLoading} currency={venue.currency} timeZone={venue.timeZone} />
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Hours" value={hours} icon={<Clock className="h-4 w-4" aria-hidden="true" />} />
        <StatCard label="Courts" value={courts} icon={<LayoutGrid className="h-4 w-4" aria-hidden="true" />} />
        <StatCard
          label="Price from"
          value={<><Money amount={venue.hourlyRate} currency={venue.currency} /> <span className="text-base font-medium text-fg-muted">/ hour</span></>}
          icon={<Ticket className="h-4 w-4" aria-hidden="true" />}
        />
        <StatCard
          label="Free cancellation"
          value="24 hours"
          hint={`Before the start. Within 24 hours the venue keeps ${cancelPercent}%.`}
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        />
      </div>
    </section>
  );
}
