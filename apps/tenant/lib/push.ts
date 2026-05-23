/**
 * Phase 10.5 — browser-side helpers for the web-push opt-in flow.
 *
 * The flow:
 *
 *   1. Caller checks {@link isPushSupported} to gate the UI button.
 *   2. On click, caller invokes {@link subscribeToPush} which:
 *      a. Awaits the active service worker registration.
 *      b. Requests `Notification.permission` if not yet granted.
 *      c. Calls `registration.pushManager.subscribe(...)` with the
 *         VAPID public key.
 *      d. POSTs the subscription to the API.
 *
 * The VAPID public key comes in via
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. When the env var is empty the
 * helper short-circuits with a clear error so the UI can render a
 * "push not configured" notice instead of a broken click target.
 */
import type { CreatePushSubscriptionInput, PushSubscription } from '@repo/shared';

import { api } from './api';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    VAPID_PUBLIC_KEY.length > 0
  );
}

export class PushSubscriptionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unsupported'
      | 'permission-denied'
      | 'no-service-worker'
      | 'vapid-missing'
      | 'api-error',
  ) {
    super(message);
  }
}

export async function subscribeToPush(): Promise<PushSubscription> {
  if (!VAPID_PUBLIC_KEY) {
    throw new PushSubscriptionError(
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set in this build.',
      'vapid-missing',
    );
  }
  if (!isPushSupported()) {
    throw new PushSubscriptionError('Push notifications are not supported here.', 'unsupported');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new PushSubscriptionError('Browser denied notification permission.', 'permission-denied');
  }

  const registration = await navigator.serviceWorker.ready;
  if (!registration) {
    throw new PushSubscriptionError('No active service worker.', 'no-service-worker');
  }

  // Re-use an existing subscription when present — re-subscribing
  // returns the same endpoint, so the server-side upsert keys are
  // consistent.
  const existing = await registration.pushManager.getSubscription();
  // PushSubscriptionOptionsInit expects BufferSource; the modern lib
  // typings narrow Uint8Array<ArrayBufferLike> too tightly, so we
  // hand the underlying ArrayBuffer.
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer;
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    }));

  const body: CreatePushSubscriptionInput = serializeSubscription(subscription);
  return api.post<PushSubscription>('/v1/notifications/push-subscriptions', body);
}

export async function unsubscribeFromPush(id: string): Promise<void> {
  // Server-side delete + best-effort client-side unsubscribe. We don't
  // fail the API call if the local unsubscribe throws — the row's
  // gone and the next push attempt will 410-prune the orphan.
  await api.delete(`/v1/notifications/push-subscriptions/${id}`);
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch {
      // intentionally swallowed; server is authoritative.
    }
  }
}

function serializeSubscription(s: globalThis.PushSubscription): CreatePushSubscriptionInput {
  const json = s.toJSON();
  const keys = json.keys ?? {};
  return {
    endpoint: s.endpoint,
    keys: {
      p256dh: keys.p256dh ?? '',
      auth: keys.auth ?? '',
    },
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : undefined,
  };
}

/**
 * VAPID public keys are base64url-encoded. PushManager.subscribe
 * wants a Uint8Array of the raw bytes.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
