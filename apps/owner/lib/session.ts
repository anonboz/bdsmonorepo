import 'server-only';
import { cookies } from 'next/headers';

import type { MeResponse } from '@repo/shared';

import { ApiError, apiFetch, type ApiInit } from './api';

/** Concatenate the request's cookies for forwarding to the API. */
async function getCookieHeader(): Promise<string> {
  return (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Server-side current-session lookup. Returns null if the user has no session
 * or the API rejects the cookie. Forwards the incoming cookie header so the
 * upstream sees the same session.
 */
export async function getSession(): Promise<MeResponse | null> {
  const cookieHeader = await getCookieHeader();
  try {
    return await apiFetch<MeResponse>('/v1/me', { cookieHeader, cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}

/**
 * Server-side typed API call that forwards the request's session cookie.
 * Use inside Server Components / route handlers. Client components can call
 * `api.*` from `lib/api.ts` directly — fetch credentials handle the session.
 */
export async function serverApi<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const cookieHeader = await getCookieHeader();
  return apiFetch<T>(path, { cache: 'no-store', ...init, cookieHeader });
}
