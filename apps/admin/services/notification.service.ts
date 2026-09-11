// The admin console as a notification PRODUCER. Notification rows are per-user
// (userId) and never org-scoped; admin is global, so the only fan-out here is
// "every current tenant on the platform" — anyone on a draft or active lease.
// Former tenants (ended/terminated leases) are skipped.

import { db, type Prisma } from "@repo/db";
import type { NotificationPayload } from "@repo/shared";

type DbClient = typeof db | Prisma.TransactionClient;

/** Write one row per distinct current tenant. Returns the number of rows created. */
export async function notifyAllTenants(
  client: DbClient,
  payload: NotificationPayload,
): Promise<number> {
  const tenancies = await client.tenancy.findMany({
    where: { lease: { status: { in: ["draft", "active"] } } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (tenancies.length === 0) return 0;
  const { count } = await client.notification.createMany({
    data: tenancies.map(({ userId }) => ({
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      deepLink: payload.deepLink ?? null,
    })),
  });
  return count;
}
