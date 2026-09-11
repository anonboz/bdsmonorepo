// FAT service for the GLOBAL admin console: the platform-wide catalog of
// tenant payment methods. NOT org-scoped. Admin turns a method on/off for the
// whole platform and orders the list; landlords then opt into enabled methods
// per org, and tenants see the intersection.

import { db } from "@repo/db";
import {
  ForbiddenError,
  isManualPaymentMethod,
  isPaymentMethodKey,
  NotFoundError,
  PAYMENT_METHOD_KEYS,
  type PaymentMethodKey,
} from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

function assertAdmin(session: SessionContext): void {
  if (session.role !== "admin") throw new ForbiddenError("Admin access required");
}

export type PaymentMethodRow = {
  key: PaymentMethodKey;
  enabled: boolean;
  sortOrder: number;
  /** Has a working rail today; others are shown to tenants as "coming soon". */
  live: boolean;
};

// ── List (every known method, in display order) ──────────────────────────────

export async function listPaymentMethods(session: SessionContext): Promise<PaymentMethodRow[]> {
  assertAdmin(session);
  const rows = await db.paymentMethodCatalog.findMany({ orderBy: { sortOrder: "asc" } });
  const known = rows.filter((r) => isPaymentMethodKey(r.key));
  // A key missing from the table (added to the vocabulary after the migration)
  // is listed last and disabled so the admin can still turn it on.
  const missing = PAYMENT_METHOD_KEYS.filter((k) => !known.some((r) => r.key === k));
  return [
    ...known.map((r) => ({
      key: r.key as PaymentMethodKey,
      enabled: r.enabled,
      sortOrder: r.sortOrder,
      live: isManualPaymentMethod(r.key),
    })),
    ...missing.map((key, i) => ({
      key,
      enabled: false,
      sortOrder: known.length + i,
      live: isManualPaymentMethod(key),
    })),
  ];
}

// ── Update (toggle, or move up/down) ─────────────────────────────────────────

const updateSchema = z
  .object({
    enabled: z.boolean().optional(),
    move: z.enum(["up", "down"]).optional(),
  })
  .refine((v) => v.enabled !== undefined || v.move !== undefined, {
    message: "Nothing to update",
  });

export async function updatePaymentMethod(
  session: SessionContext,
  key: string,
  raw: unknown,
): Promise<PaymentMethodRow[]> {
  assertAdmin(session);
  if (!isPaymentMethodKey(key)) throw new NotFoundError("Unknown payment method");
  const input = updateSchema.parse(raw);

  await db.$transaction(async (tx) => {
    const all = await tx.paymentMethodCatalog.findMany({ orderBy: { sortOrder: "asc" } });
    const idx = all.findIndex((r) => r.key === key);
    const row =
      idx >= 0
        ? all[idx]!
        : await tx.paymentMethodCatalog.create({
            data: { key, enabled: false, sortOrder: all.length },
          });

    if (input.enabled !== undefined) {
      await tx.paymentMethodCatalog.update({
        where: { key },
        data: { enabled: input.enabled },
      });
    }

    if (input.move && idx >= 0) {
      const swapWith = input.move === "up" ? all[idx - 1] : all[idx + 1];
      if (swapWith) {
        // Swap sortOrder with the neighbour; renumber so the order stays dense.
        const reordered = [...all];
        reordered[idx] = swapWith;
        reordered[input.move === "up" ? idx - 1 : idx + 1] = row;
        await Promise.all(
          reordered.map((r, i) =>
            tx.paymentMethodCatalog.update({ where: { key: r.key }, data: { sortOrder: i } }),
          ),
        );
      }
    }
  });

  return listPaymentMethods(session);
}
