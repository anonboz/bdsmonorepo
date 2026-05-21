import type { APIRequestContext } from '@playwright/test';

import { loginAs as rawLoginAs } from './auth.js';
import type { TestUserKey } from './users.js';

/**
 * Tiny typed-JSON wrapper over a Playwright `APIRequestContext`.
 *
 * Why this exists: the four critical-flow specs each chain ~10 HTTP
 * calls. Raw `ctx.post(...)` returns the response — callers then have
 * to remember to check `ok()` and `.json()` and unwrap, which adds
 * noise to the test body and lets failures fall through silently. This
 * helper throws on non-2xx with the status + body inlined in the
 * message, so a broken step blames the right endpoint.
 */
export interface ApiClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  /**
   * Escape hatch for raw responses — used when the test needs the
   * status code or set-cookie header itself (e.g., 409 dedupe assertions).
   */
  raw: APIRequestContext;
  dispose(): Promise<void>;
}

export interface LoggedInClient extends ApiClient {
  userId: string;
  email: string;
}

export async function loginAs(key: TestUserKey): Promise<LoggedInClient> {
  const { ctx, userId, email } = await rawLoginAs(key);
  return wrap(ctx, userId, email);
}

function wrap(ctx: APIRequestContext, userId: string, email: string): LoggedInClient {
  async function unwrap<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res =
      method === 'GET'
        ? await ctx.get(path)
        : method === 'POST'
          ? await ctx.post(path, body === undefined ? {} : { data: body })
          : await ctx.patch(path, body === undefined ? {} : { data: body });
    if (!res.ok()) {
      const text = await res.text();
      throw new Error(`${method} ${path} → ${res.status()}: ${text}`);
    }
    // 204 has no body; coerce to undefined.
    if (res.status() === 204) return undefined as T;
    return (await res.json()) as T;
  }
  return {
    raw: ctx,
    userId,
    email,
    get: <T>(path: string) => unwrap<T>('GET', path),
    post: <T>(path: string, body?: unknown) => unwrap<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) => unwrap<T>('PATCH', path, body),
    dispose: () => ctx.dispose(),
  };
}
