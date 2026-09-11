// @repo/shared/notifications — the vocabulary for in-app notifications. Rows
// live in the `Notification` table, which is per-user and NOT org-scoped (a
// tenant can rent from several orgs, so the inbox is global to the user).
// Producers (landlord app today; admin/vendor later) write rows; the tenant app
// reads them. `type` is a stable machine key the tenant UI localizes; `title`
// and `body` are the producer's human-readable text, shown as-is.

export const NOTIFICATION_TYPES = [
  "invoice_created",
  "invoice_status_changed",
  "lease_created",
  "lease_status_changed",
  "announcement_published",
  "maintenance_request_created",
  "maintenance_request_updated",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/** What a producer supplies; `userId` + timestamps are filled in by the service. */
export type NotificationPayload = {
  type: NotificationType;
  title: string;
  body?: string;
  /** Path inside the tenant app, e.g. "/my-bills/<invoiceId>". */
  deepLink?: string;
};
