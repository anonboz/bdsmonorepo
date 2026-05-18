import 'server-only';
import { cookies } from 'next/headers';

import type { MeResponse } from '@repo/shared';

import { ApiError, apiFetch } from './api';

/**
 * Server-side current-session lookup. Returns null if the user has no session
 * or the API rejects the cookie. Forwards the incoming cookie header so the
 * upstream sees the same session.
 */
export async function getSession(): Promise<MeResponse | null> {
  const cookieHeader = (await cookies())
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');

  try {
    return await apiFetch<MeResponse>('/v1/me', { cookieHeader, cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return null;
    throw err;
  }
}
