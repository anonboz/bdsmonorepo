import { localeMiddleware } from '@repo/i18n';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Lightweight middleware: forwards everything as-is. Real auth gating happens
 * in `app/layout.tsx` server component. Stamps the Phase 11.1 locale cookie
 * even though admin stays English-only — keeps the four apps' wiring identical.
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
