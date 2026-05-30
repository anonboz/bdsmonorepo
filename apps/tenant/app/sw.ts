/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  Serwist,
  StaleWhileRevalidate,
  type PrecacheEntry,
  type SerwistGlobalConfig,
} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  fallbacks: {
    entries: [{ url: '/offline', matcher: ({ request }) => request.destination === 'document' }],
  },
  runtimeCaching: [
    // 1. API GETs — network-first (fresh data wins; cache only when offline).
    {
      matcher: ({ url, request }) =>
        request.method === 'GET' && url.origin === new URL(API_URL).origin,
      handler: new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 5,
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 })],
      }),
    },
    // 2. Static assets — stale-while-revalidate.
    {
      matcher: ({ request }) =>
        ['style', 'script', 'worker', 'image', 'font'].includes(request.destination),
      handler: new StaleWhileRevalidate({
        cacheName: 'asset-cache',
        plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    // 3. Same-origin fonts/images that miss above — cache-first long.
    {
      matcher: /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/i,
      handler: new CacheFirst({
        cacheName: 'static-assets',
        plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 })],
      }),
    },
    // 4. Fall through to Serwist defaults (HTML, etc.).
    ...defaultCache,
  ],
});

serwist.addEventListeners();

// Phase 10.5 — render incoming web push notifications. Payload shape
// matches what the API's `notifications.worker.ts` sends:
// `{ title, body, url, topic }`.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: { title?: string; body?: string; url?: string; topic?: string };
  try {
    payload = event.data.json() as typeof payload;
  } catch {
    payload = { title: event.data.text() };
  }
  const title = payload.title ?? 'Notification';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? '',
      tag: payload.topic ?? 'default',
      data: { url: payload.url ?? '/notifications' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    }),
  );
});
