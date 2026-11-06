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

export type PublicClosure = {
  id: string;
  courtId: string | null;
  courtName: string;
  startTime: string;
  endTime: string;
  reason: string | null;
  repeatsDaily: boolean;
  fromDate: string | null;
  untilDate: string | null;
};

export function venueHours(slug: string): Promise<PublicClosure[]> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/hours`, "no-store");
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

export function payNowHold(slug: string, courtIds: string[], date: string, start: string, end: string, repeat = false, weeks = 1, groupId?: string, discount: { points?: number; promotionCode?: string } = {}): Promise<CheckoutResult & { groupId: string }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/pay-now`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courtIds, date, start, end, weeks, repeat, groupId: groupId ?? null, points: discount.points ?? 0, promotionCode: discount.promotionCode ?? null }),
  });
}

export async function abandonCourtCheckout(slug: string, groupId: string): Promise<void> {
  const response = await apiFetch(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}/checkout-cancel`, { method: "POST", cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
    throw new AuthRequestError(body?.errors ?? { form: ["The cancelled payment could not be released."] });
  }
}

const openCheckoutKey = "shuttle-sync-open-checkout";

export function rememberOpenCheckout(slug: string, groupId: string) {
  sessionStorage.setItem(openCheckoutKey, JSON.stringify({ slug, groupId }));
}

export function forgetOpenCheckout() {
  sessionStorage.removeItem(openCheckoutKey);
}

export function readOpenCheckout(): { slug: string; groupId: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(openCheckoutKey) ?? "null") as { slug?: string; groupId?: string } | null;
    return value?.slug && value.groupId ? { slug: value.slug, groupId: value.groupId } : null;
  } catch {
    return null;
  }
}

export type ReleasedRetry = {
  date: string;
  start: string;
  end: string;
  courtIds: string[];
  weeks: number;
  repeat: boolean;
};

export function bookAgainPath(slug: string, retry: ReleasedRetry) {
  const params = new URLSearchParams({
    date: retry.date,
    start: retry.start,
    end: retry.end,
    courts: retry.courtIds.join(","),
    weeks: String(retry.weeks),
  });
  if (retry.repeat) params.set("repeat", "1");
  return `/${encodeURIComponent(slug)}/book?${params}`;
}

export function courtHold(slug: string, groupId: string): Promise<{ currency: string; pointsPerDollar: number; lateCancelFeePercent: number; timeZone: string; sessions: CourtHoldSession[]; released?: boolean; retry?: ReleasedRetry | null }> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}`, "no-store");
}

export function rememberCourtPromo(code: string) {
  const trimmed = code.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem("shuttle-sync-promo-latest", trimmed.toUpperCase());
  } catch {
    // Private browsing can block storage. The pay link still carries the code.
  }
}

export function savedCourtPromo(groupId?: string) {
  try {
    return (groupId ? sessionStorage.getItem(`shuttle-sync-promo-${groupId}`) : null) || sessionStorage.getItem("shuttle-sync-promo-latest");
  } catch {
    return null;
  }
}

export function rememberCourtPromoLink(actions: { href?: string | null; promoCode?: string | null }[]) {
  for (const action of actions) {
    const fromField = action.promoCode?.trim();
    let fromHref: string | null = null;
    let group: string | null = null;
    if (action.href) {
      try {
        const url = new URL(action.href, window.location.origin);
        fromHref = url.searchParams.get("promo");
        group = url.pathname.match(/\/book\/group\/([0-9a-f-]{36})/i)?.[1] ?? null;
      } catch {
        fromHref = null;
      }
    }
    const promo = fromHref || fromField;
    if (!promo) continue;
    rememberCourtPromo(promo);
    if (group) {
      try {
        sessionStorage.setItem(`shuttle-sync-promo-${group}`, promo.toUpperCase());
      } catch {
        // The latest code is already stored.
      }
    }
  }
}

export function rememberPointShare(share: 100 | null) {
  try {
    if (share === 100) sessionStorage.setItem("shuttle-sync-points-share", "100");
    else sessionStorage.removeItem("shuttle-sync-points-share");
  } catch {
    // The pay link can still carry points=100.
  }
}

export function savedPointShare() {
  try {
    return sessionStorage.getItem("shuttle-sync-points-share") === "100" ? 100 : 0;
  } catch {
    return 0;
  }
}

export function withSavedPromo(href: string, groupId?: string) {
  let next = href;
  const promo = savedCourtPromo(groupId);
  if (promo && !next.includes("promo=")) next += `${next.includes("?") ? "&" : "?"}promo=${encodeURIComponent(promo)}`;
  if (savedPointShare() === 100 && !next.includes("points=")) next += `${next.includes("?") ? "&" : "?"}points=100`;
  return next;
}

export function startGroupCheckout(slug: string, groupId: string, points: number, promotionCode: string, bookingIds: string[]): Promise<CheckoutResult> {
  return readJson(`/api/venues/${encodeURIComponent(slug)}/holds/${groupId}/checkout`, "no-store", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points, promotionCode: promotionCode || null, bookingIds }),
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
