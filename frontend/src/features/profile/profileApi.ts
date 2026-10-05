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
};

export type PaymentRow = {
  id: string;
  kind: string;
  amount: number;
  currency: string;
  status: string;
  occurredAt: string;
  venueName: string;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

async function readPage<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
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
};

export function myCourtWeeks(): Promise<{ weeks: CourtWeekCourt[] }> {
  return readPage("/api/me/court-weeks");
}

export function myBookings(status: string, page: number): Promise<Page<BookingRow>> {
  const params = new URLSearchParams({ status, page: String(page) });
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
};

export function myFriendSpots(status: string, page: number): Promise<Page<FriendSpot>> {
  const params = new URLSearchParams({ status, page: String(page) });
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

export function myRewards(page: number, pageSize = 20): Promise<Page<RewardRow> & { balance: number; pending: number; pendingItems: PendingReward[] }> {
  return readPage(`/api/me/rewards?page=${page}&pageSize=${pageSize}`);
}

export function myPayments(page: number): Promise<Page<PaymentRow>> {
  return readPage(`/api/me/payments?page=${page}`);
}
