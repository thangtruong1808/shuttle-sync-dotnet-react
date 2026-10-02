import { apiFetch, AuthRequestError } from "../auth/authApi";
import type { FieldErrors } from "../auth/validation";

export type Venue = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  imageUrl: string | null;
  timeZone: string;
  currency: string;
  lateCancelFeePercent: number;
  pointsPerDollar: number;
};

export type ScheduleBooking = {
  id: string;
  startTime: string;
  endTime: string;
};

export type OpenSlot = {
  id: string;
  startTime: string;
  endTime: string;
  price: number;
  incentivePoints: number | null;
};

export type ScheduleClosure = {
  id: string;
  courtId: string | null;
  startTime: string;
  endTime: string;
};

export type AvailableCourt = {
  id: string;
  courtName: string;
  courtNumber: number;
  surfaceType: string | null;
  imageUrl: string | null;
  description: string | null;
  bookings: ScheduleBooking[];
  slots?: OpenSlot[];
};

export type VenueIncentive = {
  id: string;
  points: number;
  startsOn: string;
  endsOn: string;
};

export type Availability = {
  venue: Venue;
  date: string;
  windowStart: string;
  windowEnd: string;
  courts: AvailableCourt[];
  incentives: VenueIncentive[];
  closures: ScheduleClosure[];
};

export type Promotion = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  venueId: string | null;
};

export type CourtSlotDetail = {
  venue: Venue;
  id: string;
  courtName: string;
  courtNumber: number;
  startTime: string;
  endTime: string;
  price: number;
  incentivePoints: number | null;
};

async function readJson<T>(path: string, cache?: RequestCache, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, { ...(cache ? { cache } : {}), ...init });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
    throw new AuthRequestError(body?.errors ?? { form: ["The request could not be completed."] });
  }
  return (await response.json()) as T;
}

export function listVenues(): Promise<Venue[]> {
  return readJson("/api/venues");
}

export function venueAvailability(slug: string, date: string, from: string, to: string): Promise<Availability> {
  const params = new URLSearchParams({ date });
  if (from) {
    params.set("from", from);
  }
  if (to) {
    params.set("to", to);
  }
  return readJson(`/api/venues/${encodeURIComponent(slug)}/availability?${params}`, "no-store");
}

export function venuePromotions(slug: string): Promise<Promotion[]> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/promotions`);
}

export function venueSlot(slug: string, sessionId: string): Promise<CourtSlotDetail> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/slots/${sessionId}`);
}

export type CheckoutResult = {
  bookingId: string;
  status: string;
  checkoutUrl: string | null;
  currency: string;
  subtotal: number;
  discountAmount: number;
  pointsRedeemed: number;
  pointsValue: number;
  cashAmount: number;
};

export function startCheckout(slug: string, sessionId: string, points: number, promotionCode: string): Promise<CheckoutResult> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/sessions/${sessionId}/checkout`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, promotionCode: promotionCode || null }),
  });
}

export function dashboardVenues(): Promise<Venue[]> {
  return readJson("/api/dashboard/venues", "no-store");
}

const venueKey = "shuttle-sync-venue";

export function readVenueSlug(): string | null {
  try {
    return localStorage.getItem(venueKey);
  } catch {
    return null;
  }
}

export function rememberVenueSlug(slug: string) {
  try {
    localStorage.setItem(venueKey, slug);
  } catch {
    // Private browsing can block storage. The URL still carries the venue.
  }
}
