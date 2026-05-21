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
