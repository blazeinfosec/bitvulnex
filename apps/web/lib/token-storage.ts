"use client";

const ACCESS_KEY = "bvbe.access";
const REFRESH_KEY = "bvbe.refresh";

export const AUTH_EVENT = "bvbe-auth";

function notifyAuthChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(access: string, refresh: string): void {
  window.localStorage.setItem(ACCESS_KEY, access);
  window.localStorage.setItem(REFRESH_KEY, refresh);
  notifyAuthChange();
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  notifyAuthChange();
}

/**
 * Reads the (unverified) claims out of the stored access token. Used only for
 * UI decisions like which nav links to render — the server re-checks on every
 * request.
 */
export function getTokenClaims(): { sub?: string; email?: string; role?: string } | null {
  const token = getAccessToken();
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
}

/**
 * Normalises the two error shapes the API emits: route handlers return
 * `{ error: { message } }`, the middleware returns `{ error: "unauthorized" }`.
 */
export function errorMessage(body: unknown, fallback = "Request failed"): string {
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown; message?: unknown }).error;
    if (typeof err === "string" && err) return err;
    if (err && typeof err === "object") {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg) return msg;
    }
    const msg = (body as { message?: unknown }).message;
    if (typeof msg === "string" && msg) return msg;
  }
  return fallback;
}

/** Reads a non-OK response body and returns a human-readable message. */
export async function responseError(
  res: Response,
  fallback?: string,
): Promise<string> {
  const body = await res.json().catch(() => null);
  return errorMessage(body, fallback ?? `Request failed (${res.status})`);
}

export const NO_ACCESS_MESSAGE = "You don't have access to this page.";

/**
 * Classifies a page-load response. Returns null when the response is OK;
 * `{ redirect: true }` for 401 (caller should send the user to /login);
 * otherwise a message to render (403 → access notice, others → API error).
 * Pass `null` for a request that threw (network error).
 */
export async function loadFailure(
  res: Response | null,
  fallback = "Something went wrong loading this page.",
): Promise<{ redirect: true; message?: undefined } | { redirect: false; message: string } | null> {
  if (!res) return { redirect: false, message: "Could not reach the server." };
  if (res.ok) return null;
  if (res.status === 401) return { redirect: true };
  if (res.status === 403) return { redirect: false, message: NO_ACCESS_MESSAGE };
  return { redirect: false, message: await responseError(res, fallback) };
}

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch("/api/v2/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const body = (await res.json()) as { access?: string; refresh?: string };
    if (!body.access || !body.refresh) {
      clearTokens();
      return false;
    }
    setTokens(body.access, body.refresh);
    return true;
  } catch {
    return false;
  }
}

function refreshTokens(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function withAuth(init: RequestInit): RequestInit {
  const access = getAccessToken();
  const headers = new Headers(init.headers ?? {});
  if (access) headers.set("authorization", `Bearer ${access}`);
  return { ...init, headers };
}

export async function authedFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(input, withAuth(init));
  if (res.status !== 401 || !getRefreshToken()) return res;
  const refreshed = await refreshTokens();
  if (!refreshed) return res;
  return fetch(input, withAuth(init));
}
