import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Clock,
  Flame,
  LayoutGrid,
  Sparkles,
  Tag,
} from "lucide-react";
import { Money } from "../../components/format";
import { Badge, Card, Skeleton } from "../../components/ui";
import {
  formatCount,
  formatHours,
  formatMoneyCompact,
  formatPercent,
  safeNumber,
  type HeatmapCell,
  type StatsDemandResponse,
} from "./dashboardStatsApi";
import { InlineChartEmpty } from "./statsCharts";

const HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 .. 23:00
const DAYS = [
  { index: 0, short: "Mon", full: "Monday" },
  { index: 1, short: "Tue", full: "Tuesday" },
  { index: 2, short: "Wed", full: "Wednesday" },
  { index: 3, short: "Thu", full: "Thursday" },
  { index: 4, short: "Fri", full: "Friday" },
  { index: 5, short: "Sat", full: "Saturday" },
  { index: 6, short: "Sun", full: "Sunday" },
];

function heatmapCellClass(intensity: number, bookings: number): string {
  if (bookings <= 0 || intensity <= 0) {
    return "bg-inset text-fg-muted/50 hover:ring-1 hover:ring-border";
  }
  if (intensity <= 0.25) {
    return "bg-accent/20 text-fg hover:ring-1 hover:ring-accent-text";
  }
  if (intensity <= 0.5) {
    return "bg-accent/40 text-fg hover:ring-1 hover:ring-accent-text";
  }
  if (intensity <= 0.75) {
    return "bg-accent/65 text-fg font-medium hover:ring-1 hover:ring-accent-text";
  }
  return "bg-accent text-accent-fg font-semibold hover:ring-2 hover:ring-accent-text";
}

export function DashboardDemandSkeleton() {
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-label="Loading demand insights"
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5 xl:col-span-5">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="mt-2 h-3.5 w-60" />
          <Skeleton className="mt-5 h-56 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5 xl:col-span-7">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3.5 w-64" />
          <Skeleton className="mt-5 h-56 w-full rounded-xl" />
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5">
        <Skeleton className="h-5 w-52" />
        <Skeleton className="mt-4 h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function DashboardDemandSection({
  demand,
  currency,
  dateRangeLabel,
  selectedVenueId,
  isAllVenues,
}: {
  demand: StatsDemandResponse;
  currency: string;
  dateRangeLabel: string;
  selectedVenueId: string;
  isAllVenues: boolean;
}) {
  const {
    hasData,
    busiestDay,
    dayOfWeek,
    heatmap,
    peakSlots,
    quietSlots,
    courtUtilization,
  } = demand;

  const [selectedDayOverride, setSelectedDayOverride] = useState<number | null>(null);
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);

  const defaultDayIdx = Math.max(0, dayOfWeek.findIndex((d) => d.isPeak));
  const selectedDayIdx = selectedDayOverride ?? defaultDayIdx;

  const maxDayBookings = Math.max(1, ...dayOfWeek.map((d) => safeNumber(d.bookings)));
  const activeDay =
    dayOfWeek[Math.min(Math.max(0, selectedDayIdx), dayOfWeek.length - 1)] ?? dayOfWeek[0];

  const cellLookup = new Map<string, HeatmapCell>();
  let bestCell: HeatmapCell | null = heatmap[0] ?? null;
  for (const c of heatmap) {
    cellLookup.set(`${c.dayIndex}-${c.hour}`, c);
    if (!bestCell || c.bookings > bestCell.bookings) {
      bestCell = c;
    }
  }
  const selectedCell = (selectedCellKey ? cellLookup.get(selectedCellKey) : null) ?? bestCell;

  return (
    <section aria-label="Venue demand insights" className="space-y-4">
      <div className="reveal-left">
        <h2 className="font-display text-lg font-semibold text-fg sm:text-xl">
          Demand & Court Utilization Insights
        </h2>
        <p className="text-xs text-fg-muted sm:text-sm">
          Peak days, hourly slot heatmap, promotional opportunities, and court-by-court occupancy for{" "}
          {dateRangeLabel}.
        </p>
      </div>

      {/* Row 1: Busiest Day of Week (5 cols) + Per-Court Utilization (7 cols) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12 reveal-stagger">
        {/* Card A: Busiest Day of the Week */}
        <Card
          className="xl:col-span-5"
          title="Busiest Day of the Week"
          description={
            busiestDay && busiestDay.bookings > 0 ? (
              <>
                Top day: <strong className="font-semibold text-fg">{busiestDay.fullName}</strong> (
                {formatCount(busiestDay.bookings)} bookings ·{" "}
                {formatPercent(busiestDay.sharePercent, 1)} of weekly volume)
              </>
            ) : (
              "Bookings distribution by day of the week"
            )
          }
          actions={
            busiestDay && busiestDay.bookings > 0 ? (
              <Badge tone="accent" icon={<Flame className="h-3 w-3" aria-hidden="true" />}>
                {busiestDay.shortName} Peak
              </Badge>
            ) : (
              <Badge tone="neutral" icon={<Calendar className="h-3 w-3" aria-hidden="true" />}>
                Mon – Sun
              </Badge>
            )
          }
        >
          {!hasData ? (
            <InlineChartEmpty
              icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
              title="No day-of-week demand yet"
              description={`Once bookings are confirmed in ${dateRangeLabel}, the busiest day bar chart will highlight your peak day.`}
            />
          ) : (
            <div className="space-y-4">
              {activeDay ? (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-inset px-3.5 py-2.5 text-xs"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-fg">{activeDay.fullName}</span>
                    {activeDay.isPeak ? <Badge tone="accent">Busiest</Badge> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 tabular-nums text-fg-muted">
                    <span>
                      <strong className="font-semibold text-fg">
                        {formatCount(activeDay.bookings)}
                      </strong>{" "}
                      bookings ({formatPercent(activeDay.sharePercent, 1)})
                    </span>
                    <span>· {formatHours(activeDay.bookedHours)}</span>
                    <span>
                      ·{" "}
                      <strong className="font-medium text-fg">
                        <Money amount={safeNumber(activeDay.revenue)} currency={currency} />
                      </strong>
                    </span>
                  </div>
                </div>
              ) : null}

              <div
                className="grid h-48 grid-cols-7 items-end gap-1.5 pt-4 sm:gap-3"
                role="list"
                aria-label="Bookings by day of the week"
              >
                {dayOfWeek.map((day, idx) => {
                  const pct = Math.max(
                    day.bookings > 0 ? 8 : 2,
                    Math.round((safeNumber(day.bookings) / maxDayBookings) * 100),
                  );
                  const isSelected = activeDay?.dayIndex === day.dayIndex;
                  return (
                    <button
                      key={day.dayIndex}
                      type="button"
                      role="listitem"
                      onMouseEnter={() => setSelectedDayOverride(idx)}
                      onClick={() => setSelectedDayOverride(idx)}
                      onFocus={() => setSelectedDayOverride(idx)}
                      aria-label={`${day.fullName}: ${formatCount(day.bookings)} bookings, ${formatMoneyCompact(day.revenue, currency)}`}
                      className={`group flex h-full flex-col items-center justify-end rounded-xl p-1 sm:p-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-text ${
                        isSelected ? "bg-inset" : "hover:bg-inset/60"
                      }`}
                    >
                      <span className="mb-1.5 text-[11px] font-semibold tabular-nums text-fg">
                        {formatCount(day.bookings)}
                      </span>
                      <div className="flex h-32 w-full items-end justify-center rounded-lg bg-surface-2 p-1">
                        <div
                          className={`w-full rounded-md transition-all duration-300 ${
                            day.isPeak
                              ? "bg-accent ring-1 ring-accent-text"
                              : isSelected
                                ? "bg-accent/70"
                                : "bg-accent/40 group-hover:bg-accent/60"
                          }`}
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                      <span
                        className={`mt-2 text-xs ${
                          day.isPeak
                            ? "font-bold text-accent-text"
                            : isSelected
                              ? "font-semibold text-fg"
                              : "font-medium text-fg-muted"
                        }`}
                      >
                        {day.shortName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* Card B: Per-Court Utilization Comparison */}
        <Card
          className="xl:col-span-7"
          title="Per-Court Utilization Comparison"
          description="Occupancy rate, booked hours, and revenue across courts in the selected venue."
          actions={
            <Badge tone="neutral" icon={<LayoutGrid className="h-3 w-3" aria-hidden="true" />}>
              {courtUtilization.length} {courtUtilization.length === 1 ? "court" : "courts"}
            </Badge>
          }
        >
          {courtUtilization.length === 0 ? (
            <InlineChartEmpty
              icon={<LayoutGrid className="h-5 w-5" aria-hidden="true" />}
              title="No courts configured for this venue"
              description="Add courts in the Venue Desk to track court-level occupancy and revenue."
            />
          ) : (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {courtUtilization.map((court) => {
                const util = Math.min(100, Math.max(0, safeNumber(court.utilizationPercent)));
                return (
                  <div
                    key={court.courtId}
                    className="rounded-xl border border-border bg-inset/50 px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-fg">{court.courtName}</span>
                        {isAllVenues ? (
                          <span className="text-[11px] text-fg-muted">({court.venueName})</span>
                        ) : null}
                        <Badge tone="neutral">{court.surfaceType}</Badge>
                        {!court.isActive ? <Badge tone="warning">Inactive</Badge> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2.5 tabular-nums text-fg-muted">
                        <span>
                          <strong className="font-semibold text-fg">{formatPercent(util, 1)}</strong>{" "}
                          occupancy
                        </span>
                        <span>
                          · {formatHours(court.bookedHours)} / {formatHours(court.availableHours)}
                        </span>
                        <span>· {formatCount(court.bookings)} bookings</span>
                        <span className="font-semibold text-fg">
                          · <Money amount={safeNumber(court.revenue)} currency={currency} />
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-300"
                        style={{ width: `${util}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Row 2: Day × Hour Heatmap (06:00–24:00) + Top 3 Peak Hours & Quietest Slots */}
      <Card
        className="reveal-up"
        title="Hourly Demand Heatmap (Day × Hour)"
        description="Bookable court & social slot density from 06:00 to 24:00 in venue local time."
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>Low</span>
            <span className="h-3 w-3 rounded-sm border border-border bg-inset" title="0 bookings" />
            <span className="h-3 w-3 rounded-sm bg-accent/20" title="1–25% of peak" />
            <span className="h-3 w-3 rounded-sm bg-accent/40" title="26–50% of peak" />
            <span className="h-3 w-3 rounded-sm bg-accent/65" title="51–75% of peak" />
            <span className="h-3 w-3 rounded-sm bg-accent" title="76–100% of peak" />
            <span>Peak</span>
          </div>
        }
      >
        {!hasData ? (
          <InlineChartEmpty
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            title={`No hourly slot activity for ${dateRangeLabel}`}
            description="The 7 × 18 day-by-hour demand matrix and top peak hours will populate once bookings are scheduled in this period."
          />
        ) : (
          <div className="space-y-5">
            {selectedCell ? (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-inset px-3.5 py-2.5 text-xs"
                aria-live="polite"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={selectedCell.bookings > 0 ? "accent" : "neutral"}>
                    {selectedCell.dayFull} · {selectedCell.timeLabel}
                  </Badge>
                  <span className="text-fg-muted">Tap or hover any slot cell below to inspect</span>
                </div>
                <div className="flex flex-wrap items-center gap-3 tabular-nums">
                  <span className="font-semibold text-fg">
                    {formatCount(selectedCell.bookings)}{" "}
                    {selectedCell.bookings === 1 ? "booking" : "bookings"}
                  </span>
                  <span className="text-fg-muted">· {formatHours(selectedCell.bookedHours)}</span>
                  <span className="font-semibold text-fg">
                    · <Money amount={safeNumber(selectedCell.revenue)} currency={currency} />
                  </span>
                </div>
              </div>
            ) : null}

            <div className="overflow-x-auto pb-1">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-[56px_repeat(18,minmax(32px,1fr))] items-center gap-1 text-[10px] font-medium text-fg-muted">
                  <span className="pr-2 text-right">Day</span>
                  {HOURS.map((h) => (
                    <span key={h} className="text-center tabular-nums">
                      {String(h).padStart(2, "0")}h
                    </span>
                  ))}
                </div>

                <div className="mt-1.5 space-y-1">
                  {DAYS.map((day) => (
                    <div
                      key={day.index}
                      className="grid grid-cols-[56px_repeat(18,minmax(32px,1fr))] items-center gap-1"
                    >
                      <span className="pr-2 text-right text-xs font-medium text-fg">
                        {day.short}
                      </span>
                      {HOURS.map((hour) => {
                        const key = `${day.index}-${hour}`;
                        const cell = cellLookup.get(key);
                        const bookings = cell?.bookings ?? 0;
                        const intensity = cell?.intensity ?? 0;
                        const isSelected =
                          selectedCell?.dayIndex === day.index && selectedCell?.hour === hour;
                        return (
                          <button
                            key={hour}
                            type="button"
                            onMouseEnter={() => setSelectedCellKey(key)}
                            onClick={() => setSelectedCellKey(key)}
                            onFocus={() => setSelectedCellKey(key)}
                            aria-label={`${day.full} ${String(hour).padStart(2, "0")}:00: ${bookings} bookings`}
                            className={`flex h-8 items-center justify-center rounded-md text-[11px] tabular-nums transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-text ${heatmapCellClass(
                              intensity,
                              bookings,
                            )} ${isSelected ? "ring-2 ring-accent-text" : ""}`}
                          >
                            {bookings > 0 ? bookings : ""}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Callouts: Top 3 Peak Hours + Quietest Slots (Promo Opportunities) */}
            <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 lg:grid-cols-2">
              {/* Top 3 Peak Hours */}
              <div className="rounded-xl border border-border bg-inset/60 p-3.5">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-accent-text" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-fg">Top 3 Peak Time Slots</h3>
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Highest-demand windows in {dateRangeLabel}.
                </p>
                {peakSlots.length === 0 ? (
                  <p className="mt-3 text-xs text-fg-muted">No peak slots recorded yet.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {peakSlots.map((slot, idx) => (
                      <li
                        key={`${slot.dayIndex}-${slot.hour}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <Badge tone="accent">#{idx + 1}</Badge>
                          <span className="font-semibold text-fg">
                            {slot.dayName} · {slot.timeLabel}
                          </span>
                        </div>
                        <div className="tabular-nums text-fg-muted">
                          <strong className="font-semibold text-fg">
                            {formatCount(slot.bookings)}
                          </strong>{" "}
                          bookings ·{" "}
                          <Money amount={safeNumber(slot.revenue)} currency={currency} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Quietest Days / Time Slots for Promotions */}
              <div className="rounded-xl border border-border bg-inset/60 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent-text" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-fg">
                      Quietest Daytime / Evening Windows (Promo Candidates)
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {!isAllVenues && selectedVenueId ? (
                      <Link
                        to={`/dashboard/venues/${selectedVenueId}/rates`}
                        className="font-semibold text-accent-text hover:underline"
                      >
                        Off-Peak Rates →
                      </Link>
                    ) : null}
                    <Link
                      to="/dashboard/promotions"
                      className="inline-flex items-center gap-1 font-semibold text-accent-text hover:underline"
                    >
                      <Tag className="h-3 w-3" aria-hidden="true" />
                      Promotions →
                    </Link>
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">
                  Lowest-occupancy daytime/evening slots ideal for targeted discounts or bonus reward points.
                </p>
                {quietSlots.length === 0 ? (
                  <p className="mt-3 text-xs text-fg-muted">No quiet windows identified.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {quietSlots.map((slot) => (
                      <li
                        key={`quiet-${slot.dayIndex}-${slot.hour}`}
                        className="rounded-lg border border-border bg-surface px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-fg">
                            {slot.dayName} · {slot.timeLabel}
                          </span>
                          <Badge tone="neutral">
                            {formatCount(slot.bookings)}{" "}
                            {slot.bookings === 1 ? "booking" : "bookings"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-fg-muted">{slot.suggestion}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

