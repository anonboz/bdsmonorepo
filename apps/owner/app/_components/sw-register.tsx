'use client';

import { useEffect } from 'react';

/**
 * Registers `/sw.js` (built by @serwist/next) on first mount. No-op in dev
 * because Serwist is disabled there in next.config.ts.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (err) {
        console.error('Service worker registration failed:', err);
      }
    };
    void register();
  }, []);

  return null;
}
