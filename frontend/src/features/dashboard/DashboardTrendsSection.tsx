import { CalendarCheck2, DollarSign, Info, TrendingUp } from "lucide-react";
import { Money } from "../../components/format";
import { Badge, Card, Skeleton } from "../../components/ui";
import {
  formatCount,
  formatHours,
  formatMoneyCompact,
  safeNumber,
  type StatsTrendsResponse,
} from "./dashboardStatsApi";
import {
  InlineChartEmpty,
  TrendAreaChart,
  TrendBarChart,
  type ChartSeriesPoint,
} from "./statsCharts";

export function DashboardTrendsSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-4 xl:grid-cols-2"
      aria-busy="true"
      aria-label="Loading trend charts"
    >
      {[0, 1].map((idx) => (
        <div
          key={idx}
          className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5"
        >
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-3.5 w-64" />
            </div>
            <Skeleton className="h-7 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-5 h-60 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function DashboardTrendsSection({
  trends,
  currency,
}: {
  trends: StatsTrendsResponse;
  currency: string;
}) {
  const {
    dateRangeLabel,
    previousDateRangeLabel,
    compare,
    hasCurrentData,
    hasPreviousData,
    totalBookings,
    totalRevenue,
    previousTotalBookings,
    previousTotalRevenue,
    buckets,
  } = trends;

  const showPrevious = compare && hasPreviousData;

  const revenuePoints: ChartSeriesPoint[] = buckets.map((b) => ({
    index: b.index,
    key: `rev-${b.key}`,
    label: b.label,
    shortLabel: b.shortLabel,
    current: safeNumber(b.revenue),
    previous: showPrevious && b.previousRevenue !== null ? safeNumber(b.previousRevenue) : null,
    previousLabel: b.previousLabel,
    metaText: `${formatCount(b.bookings)} ${b.bookings === 1 ? "booking" : "bookings"} · ${formatHours(b.bookedHours)}`,
  }));

  const bookingPoints: ChartSeriesPoint[] = buckets.map((b) => ({
    index: b.index,
    key: `bk-${b.key}`,
    label: b.label,
    shortLabel: b.shortLabel,
    current: safeNumber(b.bookings),
    previous: showPrevious && b.previousBookings !== null ? safeNumber(b.previousBookings) : null,
    previousLabel: b.previousLabel,
    metaText: `${formatCount(b.courtBookings)} court · ${formatCount(b.socialBookings)} social · ${formatHours(b.bookedHours)}`,
  }));

  const peakRevenueBucket = hasCurrentData
    ? [...buckets].sort((a, b) => b.revenue - a.revenue)[0] ?? null
    : null;

  const peakBookingBucket = hasCurrentData
    ? [...buckets].sort((a, b) => b.bookings - a.bookings)[0] ?? null
    : null;

  return (
    <section aria-label="Revenue and bookings trends over time" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 reveal-left">
        <div>
          <h2 className="font-display text-lg font-semibold text-fg sm:text-xl">
            Trends & Period Comparison
          </h2>
          <p className="text-xs text-fg-muted sm:text-sm">
            Revenue and booking velocity across {dateRangeLabel}
            {showPrevious ? ` compared with ${previousDateRangeLabel}` : ""}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 reveal-stagger">
        {/* Card 1: Revenue Over Time */}
        <Card
          title="Revenue Over Time"
          description={
            <>
              Period total:{" "}
              <strong className="font-semibold text-fg">
                <Money amount={safeNumber(totalRevenue)} currency={currency} />
              </strong>
              {showPrevious && previousTotalRevenue !== null ? (
                <span>
                  {" "}
                  · Prior:{" "}
                  <Money amount={safeNumber(previousTotalRevenue)} currency={currency} />
                </span>
              ) : null}
            </>
          }
          actions={
            peakRevenueBucket && peakRevenueBucket.revenue > 0 ? (
              <Badge tone="accent" icon={<TrendingUp className="h-3 w-3" aria-hidden="true" />}>
                Peak: {peakRevenueBucket.shortLabel} (
                {formatMoneyCompact(peakRevenueBucket.revenue, currency)})
              </Badge>
            ) : (
              <Badge tone="neutral" icon={<DollarSign className="h-3 w-3" aria-hidden="true" />}>
                {currency}
              </Badge>
            )
          }
        >
          {!hasCurrentData ? (
            <InlineChartEmpty
              icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
              title={`No revenue recorded for ${dateRangeLabel}`}
              description="Once court slots or drop-in social sessions are confirmed in this period, the revenue trend curve will appear here."
            />
          ) : (
            <div className="space-y-3">
              {compare && !hasPreviousData ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-inset/70 px-3 py-2 text-xs text-fg-muted">
                  <Info className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden="true" />
                  <span>
                    Not enough data to compare yet. Comparison overlay will appear once bookings exist in{" "}
                    {previousDateRangeLabel}.
                  </span>
                </div>
              ) : null}

              <TrendAreaChart
                points={revenuePoints}
                showPrevious={showPrevious}
                formatValue={(val) => formatMoneyCompact(val, currency)}
                formatAxisValue={(val) => formatMoneyCompact(val, currency)}
                currentLegendLabel={`Current (${dateRangeLabel})`}
                previousLegendLabel={`Previous (${previousDateRangeLabel})`}
                ariaLabel={`Revenue trend chart for ${dateRangeLabel}`}
              />
            </div>
          )}
        </Card>

        {/* Card 2: Bookings Over Time */}
        <Card
          title="Bookings Over Time"
          description={
            <>
              Period total:{" "}
              <strong className="font-semibold text-fg">
                {formatCount(totalBookings)} bookings
              </strong>
              {showPrevious && previousTotalBookings !== null ? (
                <span> · Prior: {formatCount(previousTotalBookings)} bookings</span>
              ) : null}
            </>
          }
          actions={
            peakBookingBucket && peakBookingBucket.bookings > 0 ? (
              <Badge tone="accent" icon={<CalendarCheck2 className="h-3 w-3" aria-hidden="true" />}>
                Peak: {peakBookingBucket.shortLabel} ({formatCount(peakBookingBucket.bookings)})
              </Badge>
            ) : (
              <Badge tone="neutral" icon={<CalendarCheck2 className="h-3 w-3" aria-hidden="true" />}>
                Bookings
              </Badge>
            )
          }
        >
          {!hasCurrentData ? (
            <InlineChartEmpty
              icon={<CalendarCheck2 className="h-5 w-5" aria-hidden="true" />}
              title={`No bookings recorded for ${dateRangeLabel}`}
              description="Confirmed and completed court or social bookings in this time window will be plotted here."
            />
          ) : (
            <div className="space-y-3">
              {compare && !hasPreviousData ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-inset/70 px-3 py-2 text-xs text-fg-muted">
                  <Info className="h-3.5 w-3.5 shrink-0 text-accent-text" aria-hidden="true" />
                  <span>
                    No bookings in {previousDateRangeLabel} to display comparison bars.
                  </span>
                </div>
              ) : null}

              <TrendBarChart
                points={bookingPoints}
                showPrevious={showPrevious}
                formatValue={(val) =>
                  `${formatCount(val)} ${val === 1 ? "booking" : "bookings"}`
                }
                formatAxisValue={(val) =>
                  Number.isInteger(val) ? formatCount(val) : val.toFixed(1)
                }
                currentLegendLabel={`Current (${dateRangeLabel})`}
                previousLegendLabel={`Previous (${previousDateRangeLabel})`}
                ariaLabel={`Bookings trend chart for ${dateRangeLabel}`}
              />
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

