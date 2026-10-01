import { apiFetch } from "../auth/authApi";

export class DashError extends Error {}

export type DashPage<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type DashVenue = {
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
  isActive: boolean;
};

export type DashCourt = {
  id: string;
  courtName: string;
  courtNumber: number;
  description: string | null;
  surfaceType: string | null;
  imageUrl: string | null;
  isActive: boolean;
};

export type DashSession = {
  id: string;
  courtId: string;
  courtName: string;
  courtNumber: number;
  startTime: string;
  endTime: string;
  price: number;
  incentivePoints: number | null;
  timeZone: string;
};

export type DashClosure = {
  id: string;
  courtId: string | null;
  courtName: string;
  startTime: string;
  endTime: string;
  reason: string | null;
  timeZone: string | null;
};

export type DashPromo = {
  id: string;
  venueId: string | null;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
};

export type DashUser = {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  mobile: string | null;
  role: string;
  rewardPoints: number;
  emailVerified: boolean;
};

export type DashUserDetail = {
  user: DashUser;
  venues: { id: string; name: string }[];
  logins: { provider: string; emailAtLink: string | null; createdAt: string }[];
  sessions: { id: string; userAgent: string | null; ipAddress: string | null; lastUsedAt: string }[];
};

export type DashBooking = {
  id: string;
  venueId: string;
  venueName: string;
  timeZone: string;
  courtName: string;
  status: string;
  totalAmount: number;
  currency: string;
  startTime: string;
  endTime: string;
  userEmail: string;
};

export type DashPayment = {
  id: string;
  kind: string;
  venueName: string;
  amount: number;
  currency: string;
  status: string;
  occurredAt: string;
};

export type DashWebhook = { id: string; eventType: string; status: string; createdAt: string };

export type DashAward = {
  id: string;
  userEmail: string;
  venueName: string;
  timeZone: string;
  points: number;
  awardedAt: string;
  startTime: string;
  endTime: string;
};

export type DashRedemption = {
  id: string;
  code: string;
  userEmail: string;
  venueName: string;
  discountAmount: number;
  createdAt: string;
};

export type DashRecommendation = {
  id: string;
  userEmail: string;
  recommendationType: string;
  createdAt: string;
  venueName: string | null;
};

export type DashActivity = {
  id: string;
  userEmail: string | null;
  displayName: string | null;
  action: string;
  entity: string;
  detail: string | null;
  createdAt: string;
  venueName: string | null;
};

async function fail(response: Response): Promise<never> {
  const body = (await response.json().catch(() => null)) as { errors?: { form?: string[] } } | null;
  throw new DashError(body?.errors?.form?.[0] ?? "The request could not be completed.");
}

async function read<T>(path: string): Promise<T> {
  const response = await apiFetch(path, { cache: "no-store" });
  if (!response.ok) {
    return fail(response);
  }
  return (await response.json()) as T;
}

async function send(path: string, method: string, body?: unknown): Promise<void> {
  const response = await apiFetch(path, {
    method,
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    return fail(response);
  }
}

export function overview(): Promise<{ venues: number; courts: number; role: string }> {
  return read("/api/dashboard/overview");
}

export function venueDetail(id: string): Promise<DashVenue> {
  return read(`/api/dashboard/venues/${id}`);
}

export function saveVenue(body: Omit<DashVenue, "id"> & { id?: string }, id?: string): Promise<void> {
  return send(id ? `/api/dashboard/venues/${id}` : "/api/dashboard/venues", id ? "PUT" : "POST", body);
}

export function deleteVenue(id: string): Promise<void> {
  return send(`/api/dashboard/venues/${id}`, "DELETE");
}

export function listCourts(venueId: string): Promise<DashCourt[]> {
  return read(`/api/dashboard/venues/${venueId}/courts`);
}

export function saveCourt(venueId: string, body: Omit<DashCourt, "id">, id?: string): Promise<void> {
  return send(id ? `/api/dashboard/venues/${venueId}/courts/${id}` : `/api/dashboard/venues/${venueId}/courts`, id ? "PUT" : "POST", body);
}

export function deleteCourt(venueId: string, courtId: string): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/courts/${courtId}`, "DELETE");
}

export function listSessions(venueId: string, date: string): Promise<DashSession[]> {
  return read(`/api/dashboard/venues/${venueId}/sessions?date=${encodeURIComponent(date)}`);
}

export function createSessions(venueId: string, body: { courtId: string; date: string; start: string; end: string; price: number }): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/sessions`, "POST", body);
}

export function updateSession(venueId: string, sessionId: string, body: { courtId: string; date: string; start: string; end: string; price: number }): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/sessions/${sessionId}`, "PUT", body);
}

export function deleteSession(venueId: string, sessionId: string): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/sessions/${sessionId}`, "DELETE");
}

export type DashVenueIncentive = {
  id: string;
  points: number;
  startsOn: string;
  endsOn: string;
  isActive: boolean;
};

export type VenueIncentiveBody = {
  startsOn: string;
  endsOn: string;
  points: number;
  isActive: boolean;
};

export function listVenueIncentives(venueId: string): Promise<DashVenueIncentive[]> {
  return read(`/api/dashboard/venues/${venueId}/incentives`);
}

export function createVenueIncentive(venueId: string, body: VenueIncentiveBody): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/incentives`, "POST", body);
}

export function updateVenueIncentive(venueId: string, incentiveId: string, body: VenueIncentiveBody): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/incentives/${incentiveId}`, "PUT", body);
}

export function deleteVenueIncentive(venueId: string, incentiveId: string): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/incentives/${incentiveId}`, "DELETE");
}

export function saveIncentive(venueId: string, sessionId: string, points: number, isActive: boolean): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/sessions/${sessionId}/incentive`, "PUT", { points, isActive });
}

export function deleteIncentive(venueId: string, sessionId: string): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/sessions/${sessionId}/incentive`, "DELETE");
}

export function listClosures(venueId: string): Promise<DashClosure[]> {
  return read(`/api/dashboard/venues/${venueId}/closures`);
}

export function createClosure(venueId: string, body: { courtId: string | null; date: string; start: string; end: string; reason: string }): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/closures`, "POST", body);
}

export function updateClosure(venueId: string, closureId: string, body: { courtId: string | null; date: string; start: string; end: string; reason: string }): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/closures/${closureId}`, "PUT", body);
}

export function deleteClosure(venueId: string, closureId: string): Promise<void> {
  return send(`/api/dashboard/venues/${venueId}/closures/${closureId}`, "DELETE");
}

export function listPromotions(venueId: string, page: number): Promise<DashPage<DashPromo>> {
  const params = new URLSearchParams({ page: String(page) });
  if (venueId) params.set("venueId", venueId);
  return read(`/api/dashboard/promotions?${params}`);
}

export function savePromotion(body: Omit<DashPromo, "id" | "usedCount">, id?: string): Promise<void> {
  return send(id ? `/api/dashboard/promotions/${id}` : "/api/dashboard/promotions", id ? "PUT" : "POST", body);
}

export function listUsers(q: string, page: number): Promise<DashPage<DashUser>> {
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set("q", q);
  return read(`/api/dashboard/users?${params}`);
}

export function userDetail(id: string): Promise<DashUserDetail> {
  return read(`/api/dashboard/users/${id}`);
}

export function updateUser(id: string, body: Pick<DashUser, "displayName" | "firstName" | "lastName" | "mobile" | "role">): Promise<void> {
  return send(`/api/dashboard/users/${id}`, "PUT", body);
}

export function deleteUser(id: string): Promise<void> {
  return send(`/api/dashboard/users/${id}`, "DELETE");
}

export function assignVenue(userId: string, venueId: string): Promise<void> {
  return send(`/api/dashboard/users/${userId}/venues/${venueId}`, "POST");
}

export function unassignVenue(userId: string, venueId: string): Promise<void> {
  return send(`/api/dashboard/users/${userId}/venues/${venueId}`, "DELETE");
}

export function revokeDevice(userId: string, sessionId: string): Promise<void> {
  return send(`/api/dashboard/users/${userId}/sessions/${sessionId}`, "DELETE");
}

export function listBookings(venueId: string, status: string, page: number): Promise<DashPage<DashBooking>> {
  const params = new URLSearchParams({ page: String(page) });
  if (venueId) params.set("venueId", venueId);
  if (status) params.set("status", status);
  return read(`/api/dashboard/bookings?${params}`);
}

export function updateBookingStatus(id: string, status: string): Promise<void> {
  return send(`/api/dashboard/bookings/${id}/status`, "PUT", { status });
}

export function listPayments(venueId: string, page: number): Promise<DashPage<DashPayment>> {
  const params = new URLSearchParams({ page: String(page) });
  if (venueId) params.set("venueId", venueId);
  return read(`/api/dashboard/payments?${params}`);
}

export function listRefunds(venueId: string, page: number): Promise<DashPage<DashPayment>> {
  const params = new URLSearchParams({ page: String(page) });
  if (venueId) params.set("venueId", venueId);
  return read(`/api/dashboard/refunds?${params}`);
}

export function listWebhooks(page: number): Promise<DashPage<DashWebhook>> {
  return read(`/api/dashboard/webhooks?page=${page}`);
}

export function listAwards(venueId: string, page: number): Promise<DashPage<DashAward>> {
  const params = new URLSearchParams({ page: String(page) });
  if (venueId) params.set("venueId", venueId);
  return read(`/api/dashboard/awards?${params}`);
}

export function listRedemptions(venueId: string, page: number): Promise<DashPage<DashRedemption>> {
  const params = new URLSearchParams({ page: String(page) });
  if (venueId) params.set("venueId", venueId);
  return read(`/api/dashboard/redemptions?${params}`);
}

export function listRecommendations(page: number): Promise<DashPage<DashRecommendation>> {
  return read(`/api/dashboard/recommendations?page=${page}`);
}

export function listActivity(userId: string, from: string, to: string, page: number): Promise<DashPage<DashActivity>> {
  const params = new URLSearchParams({ page: String(page) });
  if (userId) params.set("userId", userId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return read(`/api/dashboard/activity?${params}`);
}

export async function uploadDashboardImage(file: File, folder: "venues" | "courts"): Promise<string> {
  const body = new FormData();
  body.set("file", file);
  body.set("folder", folder);
  const response = await apiFetch("/api/dashboard/images", { method: "POST", body });
  if (!response.ok) {
    return fail(response);
  }
  const payload = (await response.json()) as { url: string };
  return payload.url;
}

export function recordPageView(path: string, title: string, venueId: string | null): void {
  void apiFetch("/api/dashboard/activity/page-view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, title, venueId }),
  }).catch(() => undefined);
}
