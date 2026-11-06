import { Link } from "react-router-dom";
import { CalendarDays, Clock, LayoutGrid, ShieldCheck, Ticket, Users } from "lucide-react";
import { Money } from "../../components/format";
import { buttonClass, Skeleton, StatCard } from "../../components/ui";
import type { Promotion, PublicRate, Venue } from "../venues/venueApi";
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
  rates,
  ratesLoading,
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
  rates: PublicRate[] | null;
  ratesLoading: boolean;
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
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Hours" value={hours} icon={<Clock className="h-4 w-4" aria-hidden="true" />} />
        <StatCard label="Courts" value={courts} icon={<LayoutGrid className="h-4 w-4" aria-hidden="true" />} />
        <StatCard
          label="Free cancellation"
          value="24 hours"
          hint={`Before the start. Within 24 hours the venue keeps ${cancelPercent}%.`}
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        />
      </div>
      <PricePanel currency={venue.currency} hourlyRate={venue.hourlyRate} rates={rates} loading={ratesLoading} />
    </section>
  );
}

const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayLabel(days: boolean[]): string {
  const selected = days.flatMap((on, index) => (on ? [index] : []));
  if (selected.length === 0) return "Selected days";
  if (selected.length === 7) return "Every day";
  if (selected.join(",") === "0,1,2,3,4") return "Weekdays";
  if (selected.join(",") === "5,6") return "Weekends";
  const groups: string[] = [];
  let start = selected[0] ?? 0;
  let previous = start;
  for (const day of selected.slice(1)) {
    if (day === previous + 1) {
      previous = day;
      continue;
    }
    groups.push(start === previous ? dayNames[start] : `${dayNames[start]}–${dayNames[previous]}`);
    start = previous = day;
  }
  groups.push(start === previous ? dayNames[start] : `${dayNames[start]}–${dayNames[previous]}`);
  return groups.join(", ");
}

function clockLabel(value: string): string {
  const [hourText, minuteText = "00"] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return minute === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function PricePanel({ currency, hourlyRate, rates, loading }: { currency: string; hourlyRate: number; rates: PublicRate[] | null; loading: boolean }) {
  const windows = [...(rates ?? [])].sort((left, right) => left.start.localeCompare(right.start) || dayLabel(left.days).localeCompare(dayLabel(right.days)));
  return (
    <section className="mt-3 rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5" aria-labelledby="court-prices">
      <div className="flex items-center justify-between gap-3">
        <h2 id="court-prices" className="text-sm font-medium text-fg-muted">Price</h2>
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/15 text-accent-text"><Ticket className="h-4 w-4" aria-hidden="true" /></span>
      </div>
      {loading || rates === null ? (
        <div className="mt-3" aria-busy="true">
          <span className="sr-only">Loading prices</span>
          <Skeleton className="h-16" />
        </div>
      ) : (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {windows.map((rate) => (
            <li key={`${dayLabel(rate.days)}-${rate.start}-${rate.end}-${rate.hourlyRate}`} className="rounded-xl border border-border bg-surface-2 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{dayLabel(rate.days)}</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg"><Money amount={rate.hourlyRate} currency={currency} /> <span className="text-sm font-medium text-fg-muted">/ hour</span></p>
              <p className="mt-1 text-sm text-fg">{clockLabel(rate.start)} – {clockLabel(rate.end)}</p>
            </li>
          ))}
          {windows.length === 0 && hourlyRate > 0 ? (
            <li className="rounded-xl border border-dashed border-border px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">All hours</p>
              <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg"><Money amount={hourlyRate} currency={currency} /> <span className="text-sm font-medium text-fg-muted">/ hour</span></p>
              <p className="mt-1 text-sm text-fg-muted">The same rate applies all week.</p>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
