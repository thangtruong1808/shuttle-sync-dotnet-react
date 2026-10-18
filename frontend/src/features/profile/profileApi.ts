import { apiFetch, AuthRequestError } from "../auth/authApi";
import type { FieldErrors } from "../auth/validation";

export type BookingFriend = {
  id: string;
  name: string;
  status: string;
  amount: number;
  canCancel: boolean;
  courtName?: string;
};

export type BookingRow = {
  id: string;
  venueName: string;
  venueSlug: string;
  courtName: string;
  courtNumber: number;
  startTime: string;
  endTime: string;
  timeZone: string;
  currency: string;
  status: string;
  totalAmount: number;
  canCancel: boolean;
  socialId?: string | null;
  groupId?: string | null;
  friends?: BookingFriend[];
  subtotalAmount?: number;
  discountAmount?: number;
  pointsRedeemed?: number;
  bookedAt?: string;
  cancelledAt?: string | null;
  wasPaid?: boolean;
  cancelFeePercent?: number;
  lateFeePercent?: number;
  pointsEarned?: number;
};

export type RewardRow = {
  id: string;
  kind?: string;
  points: number;
  awardedAt: string;
  venueName: string;
  timeZone: string;
  courtName: string;
  startTime: string;
  endTime: string;
  courtCount?: number;
  cancelledCourts?: number;
  cancelledCourtNames?: string | null;
};

export type PendingReward = {
  id: string;
  kind: string;
  points: number;
  venueName: string;
  timeZone: string;
  courtName: string;
  startTime: string;
  endTime: string;
  courtCount?: number;
  cancelledCourts?: number;
  cancelledCourtNames?: string | null;
};

export type PaymentRow = {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  status: string;
  occurredAt: string;
  venueName: string;
  source: string;
  timeZone: string;
  courtNames: string | null;
  courtCount: number;
  startTime: string;
  endTime: string;
  refundedAmount?: number;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

async function readPage<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
    throw new AuthRequestError(body?.errors ?? { form: ["The request could not be completed."] });
  }
  return (await response.json()) as T;
}

export type CourtWeekCourt = {
  bookingId: string;
  groupId: string;
  status: string;
  price: number;
  venueName: string;
  venueSlug: string;
  timeZone: string;
  currency: string;
  courtId: string;
  courtName: string;
  courtNumber: number;
  startTime: string;
  endTime: string;
  seriesWeeks?: number;
  repeatHold?: boolean;
  repeatNote?: string | null;
  cancelReason?: string | null;
};

export function myCourtWeeks(): Promise<{ weeks: CourtWeekCourt[] }> {
  return readPage("/api/me/court-weeks");
}

export function setCourtRepeat(groupId: string, enabled: boolean): Promise<{ repeatHold: boolean; note: string | null }> {
  return readPage(`/api/me/holds/${groupId}/repeat`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

export type UnpaidHold = {
  groupId: string;
  venueName: string;
  venueSlug: string;
  timeZone: string;
  startTime: string;
  endTime: string;
  payBy: string;
  courtCount: number;
  checkoutStarted: boolean;
  bookingIds: string[];
};

export const unpaidHoldListeners = new Set<() => void>();

export function refreshUnpaidHolds() {
  unpaidHoldListeners.forEach((listener) => listener());
}

export function unpaidHolds(): Promise<{ items: UnpaidHold[] }> {
  return readPage("/api/me/unpaid-holds");
}

export function deleteSeries(groupId: string): Promise<{ deleted: boolean }> {
  return readPage(`/api/me/holds/${groupId}/delete-series`, { method: "POST" });
}

export type SeriesCancelPreview = {
  currency: string;
  feePercent: number;
  paidCourts: number;
  lateCourts: number;
  charged: number;
  refund: number;
  fee: number;
  pointsBack: number;
  pointsKept: number;
};

export function deleteSeriesPreview(groupId: string): Promise<SeriesCancelPreview> {
  return readPage(`/api/me/holds/${groupId}/delete-series/preview`);
}

export function deleteUnpaidHold(groupId: string, bookingIds?: string[]): Promise<{ deleted: boolean }> {
  return readPage(`/api/me/holds/${groupId}/delete-unpaid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bookingIds: bookingIds ?? null }),
  });
}

export type WeekSlot = { date: string; start: string; end: string; label: string };

export type WeekFacts = {
  code: string;
  courts: string[];
  when: string;
  alternatives: WeekSlot[];
  difference: number | null;
};

export class WeekChangeError extends Error {
  code: string;
  fallback: string;
  facts: WeekFacts;
  paid: number;
  quote: number;

  constructor(fallback: string, facts: WeekFacts, paid = 0, quote = 0) {
    super(fallback);
    this.code = facts.code;
    this.fallback = fallback;
    this.facts = facts;
    this.paid = paid;
    this.quote = quote;
  }
}

export function weekAvailability(groupId: string, startTime: string): Promise<{ allCourtsBooked: boolean; courts: { id: string; courtName: string; yours: boolean; free: boolean }[] }> {
  return readPage(`/api/me/holds/${groupId}/week-availability?start=${encodeURIComponent(startTime)}`);
}

export function weekOpenTimes(groupId: string, startTime: string, date: string, courtIds: string[], durationMinutes?: number): Promise<{ times: WeekSlot[]; heldForRecurring: WeekSlot[] }> {
  const params = new URLSearchParams({ start: startTime, date, courts: courtIds.join(",") });
  if (durationMinutes) params.set("duration", String(durationMinutes));
  return readPage(`/api/me/holds/${groupId}/open-times?${params}`);
}

export async function applyWeekChange(
  groupId: string,
  body: { startTime: string; date: string; start: string; end: string; courtIds: string[]; acceptPriceIncrease?: boolean; acceptRefund?: boolean; changeHours?: boolean },
): Promise<{ ok: true; addedBookingIds: string[]; topUpAmount: number; payNow: boolean; payBookingIds: string[]; refundAmount: number }> {
  const response = await apiFetch(`/api/me/holds/${groupId}/week`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; fallback?: string; facts?: WeekFacts; paid?: number; quote?: number; addedBookingIds?: string[]; topUpAmount?: number; payNow?: boolean; payBookingIds?: string[]; refundAmount?: number; errors?: FieldErrors } | null;
  if (!response.ok || !payload?.ok) {
    const facts = payload?.facts ?? { code: "COURT_UNAVAILABLE", courts: [], when: "", alternatives: [], difference: null };
    throw new WeekChangeError(payload?.fallback || payload?.errors?.form?.[0] || "That change could not be saved.", facts, payload?.paid ?? 0, payload?.quote ?? 0);
  }
  return { ok: true, addedBookingIds: payload.addedBookingIds ?? [], topUpAmount: payload.topUpAmount ?? 0, payNow: payload.payNow ?? false, payBookingIds: payload.payBookingIds ?? [], refundAmount: payload.refundAmount ?? 0 };
}

export async function phraseWeekCopy(facts: WeekFacts): Promise<string | null> {
  const response = await apiFetch("/api/me/week-copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: facts.code, courts: facts.courts, when: facts.when, alternatives: facts.alternatives }),
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? null;
}

export type CourtMoveResult = {
  moved: boolean;
  code: "PRICE_INCREASE" | "PRICE_DECREASE" | null;
  paid: number;
  quote: number;
  difference: number;
  refundAmount: number;
  payNow: boolean;
  payBookingIds: string[];
};

export function moveCourtSessions(
  groupId: string,
  body: { startTime: string; bookingId?: string; date: string; start: string; end: string; acceptPriceIncrease?: boolean; acceptRefund?: boolean; changeHours?: boolean },
): Promise<CourtMoveResult> {
  return readPage(`/api/me/holds/${groupId}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function myBookings(status: string, page: number, venue?: string | null, pageSize = 5): Promise<Page<BookingRow>> {
  const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  if (venue) params.set("venue", venue);
  return readPage(`/api/me/bookings?${params}`);
}

export type FriendSpot = {
  id: string;
  name: string;
  status: string;
  amount: number;
  courtName: string;
  courtNumber: number;
  venueName: string;
  venueSlug: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  currency: string;
  socialId: string;
  youLeft: boolean;
  canCancel: boolean;
  canRename: boolean;
  subtotalAmount?: number;
  discountAmount?: number;
  pointsRedeemed?: number;
  addedAt?: string;
  cancelledAt?: string | null;
  cancelFeePercent?: number;
  lateFeePercent?: number;
  wasPaid?: boolean;
  pointsEarned?: number;
};

export function myFriendSpots(status: string, page: number, pageSize = 5): Promise<Page<FriendSpot>> {
  const params = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
  return readPage(`/api/me/friend-spots?${params}`);
}

export type CancelResult = {
  refundAmount: number;
  feePercent: number;
  pointsRestored: number;
  currency: string;
};

export type BookingPayment = {
  id: string;
  status: string;
  paymentStatus: string | null;
  currency: string;
  cashAmount: number;
  pointsRedeemed: number;
  pointsValue: number;
};

export async function renameFriend(id: string, name: string): Promise<{ id: string; name: string }> {
  const response = await apiFetch(`/api/me/social-friends/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
    throw new AuthRequestError(body?.errors ?? { form: ["The name could not be saved."] });
  }
  return (await response.json()) as { id: string; name: string };
}

export async function cancelBooking(id: string): Promise<CancelResult> {
  const response = await apiFetch(`/api/me/bookings/${id}/cancel`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
    throw new AuthRequestError(body?.errors ?? { form: ["The request could not be completed."] });
  }
  return (await response.json()) as CancelResult;
}

export function bookingPayment(id: string): Promise<BookingPayment> {
  return readPage(`/api/me/bookings/${id}`);
}

export function myRewards(page: number, pageSize = 5): Promise<Page<RewardRow> & { balance: number; pending: number; pendingItems: PendingReward[] }> {
  return readPage(`/api/me/rewards?page=${page}&pageSize=${pageSize}`);
}

export function myPayments(page: number, pageSize = 5): Promise<Page<PaymentRow>> {
  return readPage(`/api/me/payments?page=${page}&pageSize=${pageSize}`);
}

export type RecommendationRow = {
  id: string;
  recommendationType: string;
  venueName: string | null;
  timeZone: string | null;
  createdAt: string;
  readAt: string | null;
  payload: string | null;
};

export const recommendationListeners = new Set<() => void>();

export function refreshRecommendations() {
  recommendationListeners.forEach((listener) => listener());
}

export function myRecommendations(page: number, pageSize = 5): Promise<Page<RecommendationRow>> {
  return readPage(`/api/me/recommendations?page=${page}&pageSize=${pageSize}`);
}

export function unreadRecommendations(): Promise<{ count: number }> {
  return readPage("/api/me/recommendations/unread");
}

export function markRecommendationRead(id: string): Promise<{ read: boolean }> {
  return readPage(`/api/me/recommendations/${id}/read`, { method: "POST" });
}

export function markAllRecommendationsRead(): Promise<{ read: number }> {
  return readPage("/api/me/recommendations/read", { method: "POST" });
}
