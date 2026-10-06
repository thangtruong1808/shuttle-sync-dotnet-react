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
  hourlyRate: number;
  socialPrice: number;
};

export type ScheduleBooking = {
  id: string;
  status?: string;
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

export type SocialCourtLoad = {
  courtName: string;
  courtNumber: number;
  players: number;
};

export type CourtSocial = {
  id: string;
  startTime: string;
  endTime: string;
  players: number;
  totalPlayers?: number;
  courtsUsed?: number;
  playersPerCourt?: number;
  courtLimit?: number;
  full?: boolean;
  waitlistCount?: number;
};

export type PublicSocial = {
  id: string;
  startTime: string;
  endTime: string;
  playerCount: number;
  price?: number;
  yourStatus?: string | null;
  yourCourtName: string | null;
  yourCourtNumber: number | null;
  repeatWeekly?: boolean;
  playersPerCourt?: number;
  courtLimit?: number;
  full?: boolean;
  waitlistCount?: number;
  courts?: SocialCourtLoad[];
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
  socials?: CourtSocial[];
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
  socials?: PublicSocial[];
  incentives: VenueIncentive[];
  closures: ScheduleClosure[];
};

export type Promotion = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  venueId: string | null;
  validFrom: string;
  validTo: string;
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

export function courtPrice(slug: string, date: string, start: string, end: string, weeks: number): Promise<{ courtAmount: number; scheduled: boolean }> {
  const params = new URLSearchParams({ date, start, end, weeks: String(weeks) });
  return readJson(`/api/venues/${encodeURIComponent(slug)}/court-price?${params}`, "no-store");
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

export type SocialCheckout = {
  registrationId: string;
  status: string;
  checkoutUrl: string | null;
  amount: number;
  currency: string;
  courtName: string;
  courtNumber: number;
  alreadyJoined: boolean;
  subtotal: number;
  discountAmount: number;
  pointsRedeemed: number;
  pointsValue: number;
  cashAmount: number;
  incentivePoints: number;
};

export type SocialRegistration = {
  id: string;
  status: string;
  courtName: string;
  courtNumber: number;
  paymentStatus: string | null;
  cashAmount: number;
  pointsRedeemed: number;
  incentivePoints: number;
};

export type SocialOffer = {
  venue: Venue;
  id: string;
  startTime: string;
  endTime: string;
  price: number;
  playerCount: number;
  playersPerCourt?: number;
  courtCount?: number;
  courts?: SocialCourtLoad[];
  yourStatus?: string | null;
  yourCourtName: string | null;
  yourCourtNumber: number | null;
  incentivePoints: number;
  full?: boolean;
  waitlistCount?: number;
};

export function openSocials(slug: string): Promise<{ venue: Venue; courtCount: number; socials: PublicSocial[] }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials`, "no-store");
}

export type SocialRosterCourt = {
  courtName: string;
  courtNumber: number;
  players: string[];
};

export function socialRoster(slug: string, socialId: string): Promise<{ courts: SocialRosterCourt[] }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/${socialId}/players`, "no-store");
}

export function socialOffer(slug: string, socialId: string): Promise<SocialOffer> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/${socialId}`, "no-store");
}

export function startSocialBatchCheckout(slug: string, socialIds: string[], points: number, promotionCode: string): Promise<SocialCheckout> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/checkout`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ socialIds, points, promotionCode: promotionCode || null }),
  });
}

export function startWaitlistCheckout(slug: string, socialId: string, points: number, promotionCode: string): Promise<SocialCheckout> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/${socialId}/waitlist`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, promotionCode: promotionCode || null }),
  });
}

export function startSocialCheckout(slug: string, socialId: string, points: number, promotionCode: string): Promise<SocialCheckout> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/${socialId}/checkout`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, promotionCode: promotionCode || null }),
  });
}

export type SocialFriend = {
  id: string;
  name: string;
  status: string;
  amount: number;
  courtName: string;
  checkoutGroupId: string;
  canCancel: boolean;
};

export function socialFriends(slug: string, socialId: string): Promise<{ placesLeft: number; friends: SocialFriend[] }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/${socialId}/friends`, "no-store");
}

export function startFriendCheckout(slug: string, socialId: string, names: string[], points: number, promotionCode: string): Promise<SocialCheckout & { friendGroupId?: string | null }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/${socialId}/friends`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ names, points, promotionCode: promotionCode || null }),
  });
}

export function socialRegistration(slug: string, registrationId: string): Promise<SocialRegistration> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/socials/registrations/${registrationId}`, "no-store");
}

export type CourtHoldSession = {
  bookingId: string;
  courtName: string;
  courtNumber: number;
  startTime: string;
  endTime: string;
  price: number;
  status: string;
  incentivePoints: number;
  holdExpiresAt: string | null;
  payNow: boolean;
};

export type PayNowSlot = { date: string; start: string; end: string; courtIds: string[] };

export function openCourtHold(slug: string, courtIds: string[], date: string, start: string, end: string, weeks: number, repeat = false): Promise<{ groupId: string; notice?: string | null; payNow?: PayNowSlot | null }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courtIds, date, start, end, weeks, repeat }),
  });
}

export function payNowHold(slug: string, courtIds: string[], date: string, start: string, end: string, repeat = false, weeks = 1, groupId?: string): Promise<CheckoutResult & { groupId: string }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/pay-now`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courtIds, date, start, end, weeks, repeat, groupId: groupId ?? null }),
  });
}

export async function abandonCourtCheckout(slug: string, groupId: string): Promise<void> {
  const response = await apiFetch(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}/checkout-cancel`, { method: "POST", cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
    throw new AuthRequestError(body?.errors ?? { form: ["The cancelled payment could not be released."] });
  }
}

export function courtHold(slug: string, groupId: string): Promise<{ currency: string; pointsPerDollar: number; lateCancelFeePercent: number; timeZone: string; sessions: CourtHoldSession[]; released?: boolean }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}`, "no-store");
}

export function startGroupCheckout(slug: string, groupId: string, points: number, promotionCode: string, bookingIds: string[]): Promise<CheckoutResult> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}/checkout`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, promotionCode: promotionCode || null, bookingIds }),
  });
}

export function addHoldCourts(slug: string, groupId: string, start: string, end: string, courtIds: string[]): Promise<{ added: number }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}/courts`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courtIds, start, end }),
  });
}

export function openPlayerSession(slug: string, courtId: string, date: string, start: string, end: string): Promise<{ sessionId: string; price: number; currency: string }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/sessions`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courtId, date, start, end }),
  });
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
const defaultVenueKey = "shuttle-sync-default-venue";

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

export function readDefaultVenueSlug(): string | null {
  try {
    return localStorage.getItem(defaultVenueKey);
  } catch {
    return null;
  }
}

export function writeDefaultVenueSlug(slug: string | null) {
  try {
    if (slug) {
      localStorage.setItem(defaultVenueKey, slug);
    } else {
      localStorage.removeItem(defaultVenueKey);
    }
  } catch {
    // Private browsing can block storage. The current page still shows the venue.
  }
}

export function venueForPage<T extends { slug: string }>(
  venues: T[] | null | undefined,
  routeSlug: string | undefined,
  defaultSlug: string | null,
): T | null {
  if (!venues?.length) return null;
  const onThisPage = routeSlug ? venues.find((venue) => venue.slug === routeSlug) : undefined;
  if (onThisPage) return onThisPage;
  const chosen = defaultSlug ? venues.find((venue) => venue.slug === defaultSlug) : undefined;
  if (chosen) return chosen;
  const remembered = readVenueSlug();
  return venues.find((venue) => venue.slug === remembered) ?? venues[0];
}
