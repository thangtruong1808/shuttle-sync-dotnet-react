import { apiFetch, AuthRequestError } from "../auth/authApi";
import type { FieldErrors } from "../auth/validation";

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
};

export type RewardRow = {
  id: string;
  points: number;
  awardedAt: string;
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

export function myBookings(status: string, page: number): Promise<Page<BookingRow>> {
  const params = new URLSearchParams({ status, page: String(page) });
  return readPage(`/api/me/bookings?${params}`);
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

export function myRewards(page: number): Promise<Page<RewardRow> & { balance: number }> {
  return readPage(`/api/me/rewards?page=${page}`);
}

export function myPayments(page: number): Promise<Page<PaymentRow>> {
  return readPage(`/api/me/payments?page=${page}`);
}
