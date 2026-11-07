import { apiFetch } from "../auth/authApi";
import { DashError } from "./dashboardApi";

export type StatsPeriod = "weekly" | "monthly" | "quarterly" | "yearly";

export type TrendPolarity = "up_good" | "down_bad" | "up_bad" | "down_good" | "neutral";

export type StatsVenueOption = {
  id: string;
  name: string;
  slug: string;
  suburb: string | null;
  state: string | null;
  timeZone: string;
  currency: string;
  isActive: boolean;
  activeCourts: number;
};

export type MetricDelta = {
  current: number;
  previous: number | null;
  deltaPercent: number | null;
  trend: TrendPolarity;
};

export type UtilizationMetric = {
  current: number;
  previous: number | null;
  deltaPercent: number | null;
  trend: TrendPolarity;
  bookedHours: number;
  availableHours: number;
  previousBookedHours: number | null;
  previousAvailableHours: number | null;
};

export type RateMetric = {
  current: number;
  previous: number | null;
  deltaPercent: number | null;
  trend: TrendPolarity;
  count: number;
  denominator: number;
};

export type RetentionOverviewMetric = {
  newPlayers: number;
  returningPlayers: number;
  totalPlayers: number;
  returningRatePercent: number;
  previousReturningRatePercent: number | null;
  deltaPercent: number | null;
  trend: TrendPolarity;
};

export type StatsOverviewResponse = {
  venues: StatsVenueOption[];
  selectedVenueId: string;
  selectedVenueName: string;
  isAllVenues: boolean;
  timeZone: string;
  currency: string;
  activeCourts: number;
  period: StatsPeriod;
  anchorDate: string;
  startDate: string;
  endDate: string;
  dateRangeLabel: string;
  previousDateRangeLabel: string;
  isPartialPeriod: boolean;
  elapsedDays: number;
  totalDays: number;
  compare: boolean;
  hasCurrentData: boolean;
  hasPreviousData: boolean;
  totalBookings: MetricDelta;
  courtBookings: number;
  socialBookings: number;
  totalRevenue: MetricDelta;
  courtRevenue: number;
  socialRevenue: number;
  discountsGranted: number;
  avgRevenuePerBooking: MetricDelta;
  courtUtilization: UtilizationMetric;
  cancellationRate: RateMetric;
  rescheduleRate: RateMetric;
  playerRetention: RetentionOverviewMetric;
};

export type TrendBucket = {
  index: number;
  key: string;
  label: string;
  shortLabel: string;
  bookings: number;
  courtBookings: number;
  socialBookings: number;
  revenue: number;
  bookedHours: number;
  previousLabel: string | null;
  previousBookings: number | null;
  previousRevenue: number | null;
};

export type StatsTrendsResponse = {
  period: StatsPeriod;
  dateRangeLabel: string;
  previousDateRangeLabel: string;
  compare: boolean;
  hasCurrentData: boolean;
  hasPreviousData: boolean;
  totalBookings: number;
  totalRevenue: number;
  previousTotalBookings: number | null;
  previousTotalRevenue: number | null;
  buckets: TrendBucket[];
};

export type DayDemandItem = {
  dayIndex: number;
  shortName: string;
  fullName: string;
  bookings: number;
  bookedHours: number;
  revenue: number;
  sharePercent: number;
  isPeak: boolean;
};

export type HeatmapCell = {
  dayIndex: number;
  dayShort: string;
  dayFull: string;
  hour: number;
  timeLabel: string;
  bookings: number;
  bookedHours: number;
  revenue: number;
  intensity: number;
};

export type SlotHighlight = {
  dayIndex: number;
  dayName: string;
  shortDay: string;
  hour: number;
  timeLabel: string;
  bookings: number;
  bookedHours: number;
  revenue: number;
  suggestion: string;
};

export type CourtUtilizationItem = {
  courtId: string;
  venueId: string;
  venueName: string;
  courtName: string;
  courtNumber: number;
  surfaceType: string;
  isActive: boolean;
  bookings: number;
  bookedHours: number;
  availableHours: number;
  utilizationPercent: number;
  revenue: number;
};

export type StatsDemandResponse = {
  hasData: boolean;
  totalBookings: number;
  busiestDay: DayDemandItem | null;
  dayOfWeek: DayDemandItem[];
  heatmap: HeatmapCell[];
  peakSlots: SlotHighlight[];
  quietSlots: SlotHighlight[];
  courtUtilization: CourtUtilizationItem[];
};

export type PlayerRetentionDetail = {
  newPlayers: number;
  returningPlayers: number;
  totalUniquePlayers: number;
  newSharePercent: number;
  returningSharePercent: number;
  repeatHoldBookings: number;
  seriesBookings: number;
};

export type TopPlayerItem = {
  rank: number;
  userId: string;
  displayName: string;
  email: string;
  initials: string;
  bookingsCount: number;
  courtBookingsCount: number;
  socialBookingsCount: number;
  bookedHours: number;
  totalSpend: number;
  lastBookingAt: string;
  isReturning: boolean;
};

export type PaymentStatusBreakdownItem = {
  status: string;
  label: string;
  count: number;
  grossAmount: number;
  refundedAmount: number;
  netAmount: number;
  sharePercent: number;
};

export type ChannelBreakdownItem = {
  channel: string;
  label: string;
  bookingsCount: number;
  revenue: number;
  sharePercent: number;
};

export type StatsPlayersResponse = {
  hasData: boolean;
  retention: PlayerRetentionDetail;
  topPlayers: TopPlayerItem[];
  paymentBreakdown: PaymentStatusBreakdownItem[];
  channelBreakdown: ChannelBreakdownItem[];
};

export type StatsQueryParams = {
  venueId?: string;
  period: StatsPeriod;
  date?: string;
  from?: string;
  to?: string;
  compare?: boolean;
};

function buildStatsQuery(params: StatsQueryParams): string {
  const search = new URLSearchParams();
  if (params.venueId) search.set("venueId", params.venueId);
  search.set("period", params.period);
  if (params.date) search.set("date", params.date);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.compare !== undefined) search.set("compare", String(params.compare));
  return search.toString();
}

async function readStats<T>(path: string): Promise<T> {
  const response = await apiFetch(path, { cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: { form?: string[] } } | null;
    const message =
      body?.errors?.form?.[0] ??
      (response.status === 401 ? "Sign in again." : "Statistics could not be loaded.");
    throw new DashError(message);
  }
  return (await response.json()) as T;
}

export function fetchStatsOverview(params: StatsQueryParams): Promise<StatsOverviewResponse> {
  return readStats<StatsOverviewResponse>(`/api/dashboard/stats/overview?${buildStatsQuery(params)}`);
}

export function fetchStatsTrends(params: StatsQueryParams): Promise<StatsTrendsResponse> {
  return readStats<StatsTrendsResponse>(`/api/dashboard/stats/trends?${buildStatsQuery(params)}`);
}

export function fetchStatsDemand(params: StatsQueryParams): Promise<StatsDemandResponse> {
  return readStats<StatsDemandResponse>(`/api/dashboard/stats/demand?${buildStatsQuery(params)}`);
}

export function fetchStatsPlayers(params: StatsQueryParams): Promise<StatsPlayersResponse> {
  return readStats<StatsPlayersResponse>(`/api/dashboard/stats/players?${buildStatsQuery(params)}`);
}

export function shiftAnchorDate(anchorDate: string, period: StatsPeriod, direction: -1 | 1): string {
  const parts = anchorDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return anchorDate;
  }
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));

  if (period === "weekly") {
    date.setUTCDate(date.getUTCDate() + direction * 7);
  } else if (period === "monthly") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
  } else if (period === "quarterly") {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction * 3);
  } else {
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() + direction);
  }

  return date.toISOString().slice(0, 10);
}

export function safeNumber(value: number | null | undefined, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(safeNumber(value));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  const num = safeNumber(value);
  return `${num.toFixed(digits)}%`;
}

export function formatHours(value: number | null | undefined): string {
  const num = safeNumber(value);
  return `${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(num)}h`;
}

export function formatMoneyCompact(amount: number | null | undefined, currency = "AUD"): string {
  const num = safeNumber(amount);
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency || "AUD",
    maximumFractionDigits: num >= 1000 ? 0 : 2,
  }).format(num);
}

