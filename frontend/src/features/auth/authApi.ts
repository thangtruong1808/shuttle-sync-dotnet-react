import type { FieldErrors } from "./validation";

export type User = {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
};

export type SessionSummary = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  isCurrent: boolean;
};

const csrfCookieName = "__Host-ss_csrf";

export class AuthRequestError extends Error {
  readonly fieldErrors: FieldErrors;

  constructor(fieldErrors: FieldErrors) {
    super("Authentication request failed");
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Get the API base URL.
 * @returns The API base URL.
 */

function apiBase(): string {
  return (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
}

/**
 * Read the CSRF token from the cookie.
 * @returns The CSRF token or null if not found.
 */

export function readCsrfToken(): string | null {
  const prefix = `${csrfCookieName}=`;
  for (const part of document.cookie.split(";")) {
    const cookie = part.trim();
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.slice(prefix.length));
    }
  }
  return null;
}

/**
 * Ensure that the CSRF cookie is present.
 * @returns A promise that resolves when the CSRF cookie is present.
 */

export async function ensureCsrfCookie(): Promise<void> {
  if (readCsrfToken()) {
    return;
  }

  await fetch(`${apiBase()}/api/auth/csrf`, { credentials: "include" });
}

/**
 * Fetch data from the API.
 * @param path The path to fetch from.
 * @param init The request init.
 * @param retry Whether to retry the request if it fails.
 * @returns The response.
 */
export async function apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  await ensureCsrfCookie();
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrfToken = readCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRF-Token", csrfToken);
    }
  }

  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const skipRefresh = path === "/api/auth/login" || path === "/api/auth/register" || path === "/api/auth/refresh";
  if (response.status === 401 && retry && !skipRefresh) {
    const refreshed = await apiFetch("/api/auth/refresh", { method: "POST" }, false);
    if (refreshed.ok) {
      return apiFetch(path, init, false);
    }
  }

  return response;
}

/**
 * Parse the errors from the response.
 * @param response The response to parse the errors from.
 * @returns The errors.
 */
async function parseErrors(response: Response): Promise<FieldErrors> {
  const body = (await response.json().catch(() => null)) as { errors?: FieldErrors } | null;
  return body?.errors ?? { form: ["The request could not be completed."] };
}

/**
 * Login request.
 * @param email The email to login with.
 * @param password The password to login with.
 * @returns The user.
 */

export async function loginRequest(email: string, password: string): Promise<User> {
  const response = await apiFetch(
    "/api/auth/login",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    false,
  );
  if (!response.ok) {
    throw new AuthRequestError(await parseErrors(response));
  }
  return (await response.json()) as User;
}

/**
 * Register request.
 * @param email The email to register with.
 * @param password The password to register with.
 * @returns A promise that resolves when the registration is complete.
 */

export async function registerRequest(email: string, password: string): Promise<void> {
  const response = await apiFetch(
    "/api/auth/register",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    },
    false,
  );
  if (!response.ok) {
    throw new AuthRequestError(await parseErrors(response));
  }
}

let sessionCheck: Promise<User | null> | null = null;

/**
 * Get the current user.
 * @returns The current user or null if not authenticated.
 */

export function currentUser(): Promise<User | null> {
  sessionCheck ??= readCurrentUser().finally(() => {
    sessionCheck = null;
  });
  return sessionCheck;
}

/**
 * Read the current user from the API.
 * @returns The current user or null if not authenticated.
 */

async function readCurrentUser(): Promise<User | null> {
  const response = await apiFetch("/api/auth/me");
  if (response.status === 204 || response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new AuthRequestError(await parseErrors(response));
  }
  return (await response.json()) as User;
}

/**
 * Get the session list.
 * @returns The session list.
 */

export async function sessionList(): Promise<SessionSummary[]> {
  const response = await apiFetch("/api/auth/sessions");
  if (!response.ok) {
    throw new AuthRequestError(await parseErrors(response));
  }
  return (await response.json()) as SessionSummary[];
}

export function providerStartUrl(provider: "google" | "github"): string {
  return `${apiBase()}/api/auth/${provider}/start`;
}
