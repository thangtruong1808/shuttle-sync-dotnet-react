import type { ReactNode } from "react";
import {
  Activity,
  Ban,
  CalendarCheck2,
  CalendarClock,
  DollarSign,
  Info,
  Receipt,
  Users,
} from "lucide-react";
import { Money } from "../../components/format";
import { Badge, Skeleton, type Tone } from "../../components/ui";
import {
  formatCount,
  formatHours,
  formatPercent,
  safeNumber,
  type StatsOverviewResponse,
  type TrendPolarity,
} from "./dashboardStatsApi";

function resolveBadgeTone(trend: TrendPolarity): Tone {
  if (trend === "up_good" || trend === "down_good") return "success";
  if (trend === "up_bad" || trend === "down_bad") return "danger";
  return "neutral";
}

function ComparisonBadge({
  current,
  previous,
  deltaPercent,
  trend,
  compareEnabled,
  hasPreviousData,
}: {
  current: number;
  previous: number | null;
  deltaPercent: number | null;
  trend: TrendPolarity;
  compareEnabled: boolean;
  hasPreviousData: boolean;
}) {
  if (!compareEnabled) {
    return <Badge tone="neutral">Comparison off</Badge>;
  }

  if (!hasPreviousData || previous === null) {
    return <Badge tone="neutral">No prior period data</Badge>;
  }

  const cur = safeNumber(current);
  const prev = safeNumber(previous);

  if (prev === 0 && cur === 0) {
    return <Badge tone="neutral">— 0.0% vs prior</Badge>;
  }

  if (prev === 0 && cur > 0) {
    return <Badge tone="accent">▲ New vs 0 prior</Badge>;
  }

  const delta = safeNumber(deltaPercent);
  if (delta === 0 || cur === prev) {
    return <Badge tone="neutral">— 0.0% vs prior</Badge>;
  }

  const arrow = delta > 0 ? "▲" : "▼";
  const sign = delta > 0 ? "+" : "";
  return (
    <Badge tone={resolveBadgeTone(trend)}>
      {arrow} {sign}
      {delta.toFixed(1)}%
    </Badge>
  );
}

function KpiCardShell({
  label,
  icon,
  badge,
  value,
  subtext,
  extra,
}: {
  label: string;
  icon: ReactNode;
  badge: ReactNode;
  value: ReactNode;
  subtext: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col justify-between rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text">
            {icon}
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
          <p className="break-words font-display text-2xl font-semibold tabular-nums text-fg sm:text-3xl">
            {value}
          </p>
          {badge}
        </div>
      </div>
      <div className="mt-3 border-t border-border/70 pt-2.5">
        {extra}
        <p className="text-xs leading-relaxed text-fg-muted">{subtext}</p>
      </div>
    </article>
  );
}

export function DashboardKpiSkeletonGrid() {
  return (
    <div
      className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4"
      aria-busy="true"
      aria-label="Loading business overview statistics"
    >
      {Array.from({ length: 7 }, (_, idx) => (
        <div
          key={idx}
          className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5"
        >
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-4 h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export function DashboardKpiGrid({ data }: { data: StatsOverviewResponse }) {
  const {
    currency,
    compare,
    hasCurrentData,
    hasPreviousData,
    dateRangeLabel,
    previousDateRangeLabel,
    isPartialPeriod,
    elapsedDays,
    totalDays,
    totalBookings,
    courtBookings,
    socialBookings,
    totalRevenue,
    courtRevenue,
    socialRevenue,
    discountsGranted,
    avgRevenuePerBooking,
    courtUtilization,
    cancellationRate,
    rescheduleRate,
    playerRetention,
  } = data;

  const totalPlayers = safeNumber(playerRetention.totalPlayers);
  const returningShare =
    totalPlayers > 0
      ? Math.min(100, Math.max(0, (safeNumber(playerRetention.returningPlayers) / totalPlayers) * 100))
      : 0;
  const newShare = totalPlayers > 0 ? Math.max(0, 100 - returningShare) : 0;
  const utilPct = Math.min(100, Math.max(0, safeNumber(courtUtilization.current)));

  return (
    <section aria-label="Business overview key performance indicators" className="space-y-3.5">
      {!hasCurrentData ? (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-surface px-4 py-3.5 text-sm text-fg-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-fg">No bookings recorded for {dateRangeLabel}</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              KPI cards show zero values for this window. Try selecting another period or venue to inspect historical activity.
            </p>
          </div>
        </div>
      ) : compare && !hasPreviousData ? (
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-inset px-4 py-3 text-xs text-fg-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
          <p>
            <span className="font-medium text-fg">Not enough data to compare yet.</span> Comparison badges will calculate percentage deltas once bookings exist in the previous period ({previousDateRangeLabel}).
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4 reveal-stagger">
        {/* 1. Total Bookings */}
        <KpiCardShell
          label="Total Bookings"
          icon={<CalendarCheck2 className="h-4 w-4" />}
          value={formatCount(totalBookings.current)}
          badge={
            <ComparisonBadge
              current={totalBookings.current}
              previous={totalBookings.previous}
              deltaPercent={totalBookings.deltaPercent}
              trend={totalBookings.trend}
              compareEnabled={compare}
              hasPreviousData={hasPreviousData}
            />
          }
          subtext={
            <>
              <span className="font-medium text-fg">{formatCount(courtBookings)}</span> court slots ·{" "}
              <span className="font-medium text-fg">{formatCount(socialBookings)}</span> social registrations
              {compare && hasPreviousData && totalBookings.previous !== null ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Prior ({previousDateRangeLabel}): {formatCount(totalBookings.previous)}
                </span>
              ) : null}
            </>
          }
        />

        {/* 2. Total Revenue */}
        <KpiCardShell
          label="Total Revenue"
          icon={<DollarSign className="h-4 w-4" />}
          value={<Money amount={safeNumber(totalRevenue.current)} currency={currency} />}
          badge={
            <ComparisonBadge
              current={totalRevenue.current}
              previous={totalRevenue.previous}
              deltaPercent={totalRevenue.deltaPercent}
              trend={totalRevenue.trend}
              compareEnabled={compare}
              hasPreviousData={hasPreviousData}
            />
          }
          subtext={
            <>
              <span className="font-medium text-fg">
                <Money amount={safeNumber(courtRevenue)} currency={currency} />
              </span>{" "}
              courts ·{" "}
              <span className="font-medium text-fg">
                <Money amount={safeNumber(socialRevenue)} currency={currency} />
              </span>{" "}
              socials
              {discountsGranted > 0 ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Promos & points redeemed: <Money amount={safeNumber(discountsGranted)} currency={currency} />
                </span>
              ) : compare && hasPreviousData && totalRevenue.previous !== null ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Prior: <Money amount={safeNumber(totalRevenue.previous)} currency={currency} />
                </span>
              ) : null}
            </>
          }
        />

        {/* 3. Average Revenue / Booking */}
        <KpiCardShell
          label="Avg Revenue / Booking"
          icon={<Receipt className="h-4 w-4" />}
          value={<Money amount={safeNumber(avgRevenuePerBooking.current)} currency={currency} />}
          badge={
            <ComparisonBadge
              current={avgRevenuePerBooking.current}
              previous={avgRevenuePerBooking.previous}
              deltaPercent={avgRevenuePerBooking.deltaPercent}
              trend={avgRevenuePerBooking.trend}
              compareEnabled={compare}
              hasPreviousData={hasPreviousData}
            />
          }
          subtext={
            <>
              Net revenue per confirmed court or social booking
              {compare && hasPreviousData && avgRevenuePerBooking.previous !== null ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Prior avg: <Money amount={safeNumber(avgRevenuePerBooking.previous)} currency={currency} />
                </span>
              ) : null}
            </>
          }
        />

        {/* 4. Court Utilization / Occupancy */}
        <KpiCardShell
          label="Court Utilization"
          icon={<Activity className="h-4 w-4" />}
          value={formatPercent(courtUtilization.current, 1)}
          badge={
            <ComparisonBadge
              current={courtUtilization.current}
              previous={courtUtilization.previous}
              deltaPercent={courtUtilization.deltaPercent}
              trend={courtUtilization.trend}
              compareEnabled={compare}
              hasPreviousData={hasPreviousData}
            />
          }
          extra={
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${utilPct}%` }}
              />
            </div>
          }
          subtext={
            <>
              <span className="font-medium text-fg">{formatHours(courtUtilization.bookedHours)}</span> booked of{" "}
              <span className="font-medium text-fg">{formatHours(courtUtilization.availableHours)}</span> available
              {isPartialPeriod ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Partial period (day {elapsedDays} of {totalDays})
                </span>
              ) : null}
            </>
          }
        />

        {/* 5. Cancellation Rate */}
        <KpiCardShell
          label="Cancellation Rate"
          icon={<Ban className="h-4 w-4" />}
          value={formatPercent(cancellationRate.current, 1)}
          badge={
            <ComparisonBadge
              current={cancellationRate.current}
              previous={cancellationRate.previous}
              deltaPercent={cancellationRate.deltaPercent}
              trend={cancellationRate.trend}
              compareEnabled={compare}
              hasPreviousData={hasPreviousData}
            />
          }
          subtext={
            <>
              <span className="font-medium text-fg">{formatCount(cancellationRate.count)}</span> cancelled of{" "}
              <span className="font-medium text-fg">{formatCount(cancellationRate.denominator)}</span> committed bookings
              {compare && hasPreviousData && cancellationRate.previous !== null ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Prior rate: {formatPercent(cancellationRate.previous, 1)}
                </span>
              ) : null}
            </>
          }
        />

        {/* 6. Reschedule Rate */}
        <KpiCardShell
          label="Reschedule Rate"
          icon={<CalendarClock className="h-4 w-4" />}
          value={formatPercent(rescheduleRate.current, 1)}
          badge={
            <ComparisonBadge
              current={rescheduleRate.current}
              previous={rescheduleRate.previous}
              deltaPercent={rescheduleRate.deltaPercent}
              trend={rescheduleRate.trend}
              compareEnabled={compare}
              hasPreviousData={hasPreviousData}
            />
          }
          subtext={
            <>
              <span className="font-medium text-fg">{formatCount(rescheduleRate.count)}</span> slot/hour changes across{" "}
              <span className="font-medium text-fg">{formatCount(rescheduleRate.denominator)}</span> bookings
              {compare && hasPreviousData && rescheduleRate.previous !== null ? (
                <span className="block text-[11px] text-fg-muted/80">
                  Prior rate: {formatPercent(rescheduleRate.previous, 1)}
                </span>
              ) : null}
            </>
          }
        />

        {/* 7. New vs Returning Players (spans 2 cols on xl for balanced 4+3 grid) */}
        <article className="flex min-w-0 flex-col justify-between rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:col-span-2 sm:p-5 xl:col-span-2">
          <div>
            <div className="flex items-start justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
                New vs Returning Players
              </span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text">
                <Users className="h-4 w-4" />
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2.5">
                <p className="font-display text-2xl font-semibold tabular-nums text-fg sm:text-3xl">
                  {formatCount(totalPlayers)}{" "}
                  <span className="text-base font-normal text-fg-muted">active players</span>
                </p>
                <span className="text-xs font-medium text-accent-text">
                  ({formatPercent(playerRetention.returningRatePercent, 1)} returning)
                </span>
              </div>
              <ComparisonBadge
                current={playerRetention.returningRatePercent}
                previous={playerRetention.previousReturningRatePercent}
                deltaPercent={playerRetention.deltaPercent}
                trend={playerRetention.trend}
                compareEnabled={compare}
                hasPreviousData={hasPreviousData}
              />
            </div>
          </div>

          <div className="mt-3 border-t border-border/70 pt-2.5">
            <div
              className="mb-2 flex h-2.5 w-full overflow-hidden rounded-full bg-inset"
              aria-label={`Returning players ${returningShare.toFixed(0)}%, New players ${newShare.toFixed(0)}%`}
            >
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${returningShare}%` }}
                title={`Returning: ${playerRetention.returningPlayers}`}
              />
              <div
                className="h-full bg-accent/40 transition-all duration-300"
                style={{ width: `${newShare}%` }}
                title={`New: ${playerRetention.newPlayers}`}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
                Returning:{" "}
                <strong className="font-semibold text-fg">
                  {formatCount(playerRetention.returningPlayers)}
                </strong>{" "}
                ({returningShare.toFixed(0)}%)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-accent/40" aria-hidden="true" />
                First-time at venue:{" "}
                <strong className="font-semibold text-fg">
                  {formatCount(playerRetention.newPlayers)}
                </strong>{" "}
                ({newShare.toFixed(0)}%)
              </span>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

