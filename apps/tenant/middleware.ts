import { localeMiddleware } from '@repo/i18n';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Lightweight middleware: forwards everything as-is. Real auth gating happens
 * in `app/layout.tsx` server component, where we can hit `/v1/me` and read
 * roles. Middleware here only excludes asset/PWA paths from any future
 * processing, adds a trace id so the API can correlate logs, and stamps the
 * locale cookie (Phase 11.1) on first visit so server components have a
 * stable value to render against.
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  localeMiddleware(req, res);
  const traceId =
    req.headers.get('x-trace-id') ??
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '');
  if (traceId) res.headers.set('x-trace-id', traceId);
  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|workbox-.*|icons/.*).*)',
  ],
};
