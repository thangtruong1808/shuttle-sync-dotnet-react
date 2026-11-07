import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Globe,
  LayoutGrid,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { EmptyState, ErrorState } from "../../components/format";
import { Badge, Button, PageHeader, Spinner } from "../../components/ui";
import { useScrollReveal } from "../../hooks/useScrollReveal";
import { DashError } from "./dashboardApi";
import { DashboardDemandSection, DashboardDemandSkeleton } from "./DashboardDemandSection";
import { DashboardKpiGrid, DashboardKpiSkeletonGrid } from "./DashboardKpiGrid";
import { DashboardPlayersSection, DashboardPlayersSkeleton } from "./DashboardPlayersSection";
import { DashboardTrendsSection, DashboardTrendsSkeleton } from "./DashboardTrendsSection";
import {
  fetchStatsDemand,
  fetchStatsOverview,
  fetchStatsPlayers,
  fetchStatsTrends,
  shiftAnchorDate,
  type StatsDemandResponse,
  type StatsOverviewResponse,
  type StatsPeriod,
  type StatsPlayersResponse,
  type StatsTrendsResponse,
} from "./dashboardStatsApi";
import { Check, control } from "./dashboardUi";

const PERIOD_OPTIONS: { value: StatsPeriod; label: string; hint: string }[] = [
  { value: "weekly", label: "Weekly", hint: "Mon – Sun" },
  { value: "monthly", label: "Monthly", hint: "Calendar month" },
  { value: "quarterly", label: "Quarterly", hint: "3-month quarter" },
  { value: "yearly", label: "Yearly", hint: "Jan – Dec" },
];

function normalizePeriod(raw: string | null): StatsPeriod {
  if (raw === "weekly" || raw === "monthly" || raw === "quarterly" || raw === "yearly") {
    return raw;
  }
  return "monthly";
}

export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const venueIdParam = searchParams.get("venueId") ?? "";
  const periodParam = normalizePeriod(searchParams.get("period"));
  const dateParam = searchParams.get("date") ?? "";
  const compareParam = searchParams.get("compare") !== "false";

  const [data, setData] = useState<StatsOverviewResponse | null>(null);
  const [trends, setTrends] = useState<StatsTrendsResponse | null>(null);
  const [demand, setDemand] = useState<StatsDemandResponse | null>(null);
  const [players, setPlayers] = useState<StatsPlayersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>("init");
  const [attempt, setAttempt] = useState<number>(0);

  useScrollReveal([venueIdParam, periodParam, dateParam, compareParam, loading, Boolean(data)]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const query = {
      venueId: venueIdParam || undefined,
      period: periodParam,
      date: dateParam || undefined,
      compare: compareParam,
    };

    Promise.all([
      fetchStatsOverview(query),
      fetchStatsTrends(query),
      fetchStatsDemand(query),
      fetchStatsPlayers(query),
    ])
      .then(([overviewRes, trendsRes, demandRes, playersRes]) => {
        if (!active) return;
        setData(overviewRes);
        setTrends(trendsRes);
        setDemand(demandRes);
        setPlayers(playersRes);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof DashError ? reason.message : "Dashboard statistics could not be loaded.");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setBusyAction(null);
      });

    return () => {
      active = false;
    };
  }, [venueIdParam, periodParam, dateParam, compareParam, attempt]);

  function updateQuery(
    actionKey: string,
    patch: {
      venueId?: string;
      period?: StatsPeriod;
      date?: string;
      compare?: boolean;
    },
  ) {
    if (loading) return;
    setBusyAction(actionKey);
    const next = new URLSearchParams(searchParams);

    if (patch.venueId !== undefined) {
      if (patch.venueId) next.set("venueId", patch.venueId);
      else next.delete("venueId");
    }
    if (patch.period !== undefined) {
      next.set("period", patch.period);
    }
    if (patch.date !== undefined) {
      if (patch.date) next.set("date", patch.date);
      else next.delete("date");
    }
    if (patch.compare !== undefined) {
      if (patch.compare) next.delete("compare");
      else next.set("compare", "false");
    }

    setSearchParams(next, { replace: true });
  }

  const venues = data?.venues ?? [];
  const totalCourtsAllVenues = venues.reduce((sum, v) => sum + v.activeCourts, 0);
  const selectedVenueId = data?.selectedVenueId ?? (venueIdParam || "");
  const effectiveAnchor = data?.anchorDate ?? dateParam;
  const selectedVenueObj = venues.find((v) => v.id === selectedVenueId) ?? null;

  return (
    <div className="space-y-6">
      <div className="scroll-progress-bar" aria-hidden="true" />
      <div className="reveal-left">
        <PageHeader
          title="Venue Statistics & Overview"
          description="Real-time bookings, revenue, court utilization, demand patterns, and player retention for each venue."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {selectedVenueObj ? (
                <Link
                  to={`/dashboard/venues/${selectedVenueObj.id}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-semibold text-fg shadow-card transition-colors hover:bg-surface-2 dark:shadow-none"
                >
                  <Building2 className="h-4 w-4 text-accent-text" aria-hidden="true" />
                  Manage {selectedVenueObj.name}
                  <ExternalLink className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
                </Link>
              ) : null}
              <Button
                variant="secondary"
                icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                loading={loading && busyAction === "refresh"}
                disabled={loading}
                onClick={() => {
                  setBusyAction("refresh");
                  setAttempt((v) => v + 1);
                }}
              >
                Refresh
              </Button>
            </div>
          }
        />
      </div>

      {/* Filter & Period Switcher Bar */}
      <section
        aria-label="Venue and time period controls"
        className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5 reveal-scale"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:items-end">
          {/* Venue Selector */}
          <div className="lg:col-span-5">
            <label htmlFor="stats-venue-select" className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Select Venue
            </label>
            <div className="relative mt-1.5">
              <select
                id="stats-venue-select"
                className={control}
                value={selectedVenueId}
                disabled={loading || venues.length === 0}
                onChange={(e) => updateQuery("venue", { venueId: e.target.value })}
              >
                {venues.map((venue) => {
                  const loc = [venue.suburb, venue.state].filter(Boolean).join(", ");
                  return (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                      {loc ? ` (${loc})` : ""} · {venue.activeCourts} {venue.activeCourts === 1 ? "court" : "courts"}
                    </option>
                  );
                })}
                {venues.length > 1 ? (
                  <option value="all">
                    All venues ({venues.length} venues · {totalCourtsAllVenues} courts)
                  </option>
                ) : null}
              </select>
            </div>
          </div>

          {/* Time Range Switcher: Weekly | Monthly | Quarterly | Yearly */}
          <div className="lg:col-span-7">
            <span className="block text-xs font-semibold uppercase tracking-wider text-fg-muted">
              Time Period
            </span>
            <div
              role="tablist"
              aria-label="Statistics time period"
              className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1 text-sm sm:grid-cols-4"
            >
              {PERIOD_OPTIONS.map((opt) => {
                const active = periodParam === opt.value;
                const isPending = loading && busyAction === `period-${opt.value}`;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    disabled={loading}
                    onClick={() => {
                      if (active) return;
                      updateQuery(`period-${opt.value}`, { period: opt.value });
                    }}
                    className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? "bg-surface text-fg shadow-card"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {isPending ? <Spinner className="h-3.5 w-3.5" /> : null}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Date Range Bar + Prev/Next/Current Navigation + Compare Toggle */}
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" icon={<Calendar className="h-3.5 w-3.5" aria-hidden="true" />}>
              {data ? data.dateRangeLabel : "Loading date range…"}
            </Badge>
            {data ? (
              <>
                <Badge tone="neutral" icon={<Globe className="h-3 w-3" aria-hidden="true" />}>
                  {data.timeZone}
                </Badge>
                <Badge tone="neutral" icon={<LayoutGrid className="h-3 w-3" aria-hidden="true" />}>
                  {data.activeCourts} active {data.activeCourts === 1 ? "court" : "courts"}
                </Badge>
                {data.isPartialPeriod ? (
                  <Badge tone="info" icon={<Clock className="h-3 w-3" aria-hidden="true" />}>
                    In progress · Day {data.elapsedDays} of {data.totalDays}
                  </Badge>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
            <Check
              label={
                data && compareParam
                  ? `Compare vs ${data.previousDateRangeLabel}`
                  : "Compare with previous period"
              }
              checked={compareParam}
              disabled={loading}
              onChange={(checked) => updateQuery("compare", { compare: checked })}
            />

            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                className="px-2.5"
                aria-label="Previous period"
                icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
                loading={loading && busyAction === "prev"}
                disabled={loading || !effectiveAnchor}
                onClick={() =>
                  updateQuery("prev", {
                    date: shiftAnchorDate(effectiveAnchor, periodParam, -1),
                  })
                }
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                className="px-2.5"
                aria-label="Reset to current period"
                icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                loading={loading && busyAction === "today"}
                disabled={loading || !dateParam}
                onClick={() => updateQuery("today", { date: "" })}
              >
                Current
              </Button>
              <Button
                variant="secondary"
                className="px-2.5"
                aria-label="Next period"
                icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
                loading={loading && busyAction === "next"}
                disabled={loading || !effectiveAnchor}
                onClick={() =>
                  updateQuery("next", {
                    date: shiftAnchorDate(effectiveAnchor, periodParam, 1),
                  })
                }
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content: Error / Skeleton / KPI Cards, Trends, Demand & Players */}
      {error ? (
        <ErrorState
          message={error}
          loading={loading && busyAction === "retry"}
          onRetry={() => {
            setBusyAction("retry");
            setAttempt((v) => v + 1);
          }}
        />
      ) : !data || !trends || !demand || !players ? (
        <div className="space-y-6">
          <DashboardKpiSkeletonGrid />
          <DashboardTrendsSkeleton />
          <DashboardDemandSkeleton />
          <DashboardPlayersSkeleton />
        </div>
      ) : venues.length === 0 ? (
        <EmptyState
          title="No venues assigned yet"
          body="Once a venue is created or assigned to your account, its real-time performance statistics will appear here."
        />
      ) : (
        <div className={`space-y-6 ${loading ? "opacity-75 transition-opacity" : ""}`}>
          <DashboardKpiGrid data={data} />
          <DashboardTrendsSection trends={trends} currency={data.currency} />
          <DashboardDemandSection
            demand={demand}
            currency={data.currency}
            dateRangeLabel={data.dateRangeLabel}
            selectedVenueId={data.selectedVenueId}
            isAllVenues={data.isAllVenues}
          />
          <DashboardPlayersSection
            players={players}
            currency={data.currency}
            timeZone={data.timeZone}
            dateRangeLabel={data.dateRangeLabel}
          />
        </div>
      )}

      {/* Quick Venue Operational Links */}
      {venues.length > 0 ? (
        <section aria-label="Manage venues" className="pt-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 reveal-left">
            <div>
              <h2 className="font-display text-lg font-semibold text-fg">Your Venues</h2>
              <p className="text-xs text-fg-muted">
                Click a venue card to switch its statistics view or open its operational desk.
              </p>
            </div>
            <Link
              to="/dashboard/venues"
              className="text-xs font-semibold text-accent-text hover:underline"
            >
              Open Venues Desk →
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 reveal-stagger">
            {venues.map((venue) => {
              const isSelected = !data?.isAllVenues && selectedVenueId === venue.id;
              const loc = [venue.suburb, venue.state].filter(Boolean).join(", ") || venue.slug;
              return (
                <li
                  key={venue.id}
                  className={`flex flex-col justify-between rounded-2xl border p-4 shadow-card transition-colors dark:shadow-none ${
                    isSelected
                      ? "border-accent-text bg-accent/10"
                      : "border-border bg-surface hover:bg-surface-2"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <p className="break-words font-display font-semibold text-fg">{venue.name}</p>
                      <Badge tone={isSelected ? "accent" : "neutral"}>
                        {venue.activeCourts} {venue.activeCourts === 1 ? "court" : "courts"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-muted">{loc}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5 text-xs">
                    <button
                      type="button"
                      disabled={loading || isSelected}
                      onClick={() => updateQuery(`card-${venue.id}`, { venueId: venue.id })}
                      className="font-semibold text-accent-text hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-70"
                    >
                      {isSelected ? "Viewing stats" : "View stats"}
                    </button>
                    <Link
                      to={`/dashboard/venues/${venue.id}`}
                      className="font-medium text-fg-muted hover:text-fg"
                    >
                      Manage venue →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
