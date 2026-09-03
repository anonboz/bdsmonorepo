// Service worker source, compiled by @serwist/next (see next.config.ts) into
// public/sw.js at build time. Standard Serwist + Next.js scaffold — precaches
// the build output and applies Next's default runtime-caching strategies
// (network-first for pages/RSC payloads, stale-while-revalidate for static
// assets). This app is public/unauthenticated and every page is
// `force-dynamic`, so network-first navigation is exactly what we want —
// listings never go stale, this just buys instant repeat loads of the shell
// and static assets plus a usable offline fallback.
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
