import { z } from 'zod';

import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { notificationChannelSchema } from '../enums/misc';

/**
 * The v1 set of notification topics. Free-form on the DB column
 * (`Notification.topic` is VARCHAR(120)) but pinned here so dispatch
 * callers can't typo a topic that nobody renders.
 *
 * Add a value when (a) the schema grows a per-topic template and
 * (b) at least one state-transition site dispatches it.
 */
export const NotificationTopic = {
  BILL_ISSUED: 'bill.issued',
  BILL_PAID: 'bill.paid',
  BILL_REFUNDED: 'bill.refunded',
  TICKET_OPENED: 'ticket.opened',
  TICKET_RESOLVED: 'ticket.resolved',
  JOB_COMPLETED: 'job.completed',
  PAYOUT_DISBURSED: 'payout.disbursed',
} as const;

export type NotificationTopic = (typeof NotificationTopic)[keyof typeof NotificationTopic];
export const notificationTopicSchema = z.nativeEnum(NotificationTopic);

export const notificationSchema = z.object({
  id: idSchema,
  userId: idSchema,
  channel: notificationChannelSchema,
  topic: notificationTopicSchema,
  title: z.string().max(200),
  body: z.string().max(2000).nullable(),
  /** Structured payload — each topic has its own shape; the worker
   *  + 8.3 inbox renderer interpret it. Schema-level typing is
   *  `unknown` for v1; a discriminated union by topic is a polish
   *  follow-up. */
  data: z.unknown().nullable(),
  readAt: isoDateTimeSchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  failureReason: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
});

export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  /** Only return rows where `readAt` is null. */
  unread: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const unreadCountResponseSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

export const markAllReadResponseSchema = z.object({
  updated: z.number().int().nonnegative(),
});
export type MarkAllReadResponse = z.infer<typeof markAllReadResponseSchema>;

// ---- Preferences (Phase 9.4; per-scope split + quiet hours in 10.4) -

/**
 * Phase 10.4 — which channel(s) the mute applies to. `ALL` is the
 * legacy 9.4 behaviour (both in-app and email muted together).
 * `EMAIL` mutes only outbound email but keeps the in-app row;
 * `IN_APP` is the reverse.
 */
export const NotificationPreferenceScope = {
  ALL: 'ALL',
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
} as const;
export type NotificationPreferenceScope =
  (typeof NotificationPreferenceScope)[keyof typeof NotificationPreferenceScope];
export const notificationPreferenceScopeSchema = z.nativeEnum(NotificationPreferenceScope);

/**
 * Per-`(userId, topic, scope)` opt-out toggle. The dispatch gate
 * consults this before deciding which channels to fan out on.
 */
export const notificationPreferenceSchema = z.object({
  topic: notificationTopicSchema,
  scope: notificationPreferenceScopeSchema,
  muted: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const listNotificationPreferencesResponseSchema = z.object({
  /** Every topic from the canonical taxonomy with the caller's
   *  current state. Topics with no rows return a single
   *  `scope: 'ALL', muted: false` entry — preserves the 9.4 single-
   *  toggle contract for clients that haven't upgraded. */
  preferences: z.array(notificationPreferenceSchema),
});
export type ListNotificationPreferencesResponse = z.infer<
  typeof listNotificationPreferencesResponseSchema
>;

export const upsertNotificationPreferenceSchema = z.object({
  /** Defaults to ALL when omitted so the legacy single-toggle UI
   *  continues to work without a body-shape change. */
  scope: notificationPreferenceScopeSchema.optional(),
  muted: z.boolean(),
});
export type UpsertNotificationPreferenceInput = z.infer<typeof upsertNotificationPreferenceSchema>;

/**
 * Phase 10.4 — per-user quiet-hours window. When dispatch happens
 * inside the window the email is delayed to the window's end; the
 * in-app row persists immediately. Minute offsets (0..1439) from UTC
 * midnight; `end < start` means the window wraps midnight.
 */
export const notificationQuietHoursSchema = z.object({
  startUtcMinute: z.number().int().min(0).max(1439),
  endUtcMinute: z.number().int().min(0).max(1439),
});
export type NotificationQuietHours = z.infer<typeof notificationQuietHoursSchema>;

export const getQuietHoursResponseSchema = notificationQuietHoursSchema.nullable();
export type GetQuietHoursResponse = z.infer<typeof getQuietHoursResponseSchema>;

/**
 * Phase 10.4 — combined read-only view used by the admin support
 * tool. No mutations on the admin side: support directs users to
 * the in-app settings if a change is wanted.
 */
export const adminNotificationStateResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
  quietHours: notificationQuietHoursSchema.nullable(),
});
export type AdminNotificationStateResponse = z.infer<typeof adminNotificationStateResponseSchema>;
