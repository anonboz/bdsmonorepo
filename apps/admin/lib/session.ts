import 'server-only';
import { cookies } from 'next/headers';

import type { MeResponse } from '@repo/shared';

import { ApiError, apiFetch, type ApiInit } from './api';

async function getCookieHeader(): Promise<string> {
  return (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

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
 * Use inside Server Components. Client components can call `api.*` directly.
 */
export async function serverApi<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const cookieHeader = await getCookieHeader();
  return apiFetch<T>(path, { cache: 'no-store', ...init, cookieHeader });
}
