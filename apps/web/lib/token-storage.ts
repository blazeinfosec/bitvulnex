"use client";

const ACCESS_KEY = "bvbe.access";
const REFRESH_KEY = "bvbe.refresh";

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
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}

export async function authedFetch(
  input: string,
  init: RequestInit = {},
): Promise<Response> {
  const access = getAccessToken();
  const headers = new Headers(init.headers ?? {});
  if (access) headers.set("authorization", `Bearer ${access}`);
  return fetch(input, { ...init, headers });
}
