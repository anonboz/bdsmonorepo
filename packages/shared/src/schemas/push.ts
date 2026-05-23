import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';

/**
 * Phase 10.5 — payload the browser sends after `pushManager.subscribe()`.
 * Matches the shape of `subscription.toJSON()`: `{ endpoint, keys: { p256dh, auth } }`.
 */
export const createPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(800),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(60),
  }),
  /** Free-form label captured client-side (e.g. navigator.userAgent). */
  userAgent: z.string().max(200).optional(),
});
export type CreatePushSubscriptionInput = z.infer<typeof createPushSubscriptionSchema>;

/**
 * Shape returned to the client. We deliberately omit the keys
 * + endpoint of other browsers in the list response — the user can
 * see their own subscription was created (since they're holding the
 * key material client-side), and admin tooling has no read surface
 * for the secret bits.
 */
export const pushSubscriptionSchema = z.object({
  id: idSchema,
  endpoint: z.string().url(),
  userAgent: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type PushSubscription = z.infer<typeof pushSubscriptionSchema>;

export const listPushSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(pushSubscriptionSchema),
});
export type ListPushSubscriptionsResponse = z.infer<typeof listPushSubscriptionsResponseSchema>;

/** Hard cap on per-user push subscriptions to keep fan-outs bounded. */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;
