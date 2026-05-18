import { type Problem, problemSchema, PROBLEM_CONTENT_TYPE } from '@repo/shared';

import { API_URL } from './app-config.js';

/**
 * Typed API client. All four frontends ship one of these. Always sends cookies
 * so the better-auth session is included. Throws `ApiError` on non-2xx so
 * callers can branch on `err.problem.type` (an `ErrorCode`).
 *
 * Server / client safe: on the server we forward incoming cookies via the
 * `init.headers` option. See `lib/session.ts` for the helper that does that.
 */

export class ApiError extends Error {
  constructor(
    readonly problem: Problem,
    readonly status: number,
  ) {
    super(problem.title);
    this.name = 'ApiError';
  }
}

export interface ApiInit extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Forward cookies on server-side calls. */
  cookieHeader?: string;
}

export async function apiFetch<T = unknown>(path: string, init: ApiInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
  if (init.cookieHeader) headers.set('cookie', init.cookieHeader);
  headers.set('accept', 'application/json');

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
    body:
      init.body === undefined
        ? undefined
        : init.body instanceof FormData
          ? init.body
          : JSON.stringify(init.body),
  });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    if (contentType.includes(PROBLEM_CONTENT_TYPE) || contentType.includes('application/json')) {
      const json = (await res.json().catch(() => null)) as unknown;
      const parsed = problemSchema.safeParse(json);
      if (parsed.success) throw new ApiError(parsed.data, res.status);
    }
    throw new ApiError(
      {
        type: 'common.internal_error',
        title: res.statusText || 'Request failed',
        status: res.status,
      },
      res.status,
    );
  }

  if (!contentType.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, init?: ApiInit) => apiFetch<T>(path, { ...init, method: 'GET' }),
  post: <T>(path: string, body?: unknown, init?: ApiInit) =>
    apiFetch<T>(path, { ...init, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, init?: ApiInit) =>
    apiFetch<T>(path, { ...init, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, init?: ApiInit) =>
    apiFetch<T>(path, { ...init, method: 'PUT', body }),
  delete: <T = void>(path: string, init?: ApiInit) =>
    apiFetch<T>(path, { ...init, method: 'DELETE' }),
};
