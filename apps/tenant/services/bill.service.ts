// FAT service: business logic + Prisma for the tenant's rent invoices ("bills").
// The tenant is a renter, NOT org-scoped — reach invoices through the lease's
// Tenancy rows (Tenancy.userId), cross-org, scoping by session.userId ONLY.
// Money is integer cents.

import { db } from "@repo/db";
import { NotFoundError } from "@repo/shared";

import type { SessionContext } from "@/lib/session";

export type MyBill = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  amount: number; // cents billed
  paid: number; // cents settled (succeeded payments)
  outstanding: number; // cents still owed
  status: string; // RentInvoice.status
  property: string;
  unitLabel: string;
  city: string;
};

// ── List (this tenant's bills, cross-org) ────────────────────────────────────

export async function listMyBills(
  session: SessionContext,
): Promise<{ rows: MyBill[]; total: number; outstanding: number }> {
  const invoices = await db.rentInvoice.findMany({
    where: { lease: { tenancies: { some: { userId: session.userId } } } },
    orderBy: { dueDate: "desc" },
    include: {
      lease: {
        select: {
          unit: { select: { label: true, property: { select: { name: true, city: true } } } },
        },
      },
      payments: { where: { status: "succeeded" }, select: { amount: true } },
    },
  });

  const rows: MyBill[] = invoices.map((inv) => {
    const paid = inv.payments.reduce((sum, p) => sum + p.amount, 0);
    return {
      id: inv.id,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      dueDate: inv.dueDate,
      amount: inv.amount,
      paid,
      outstanding: Math.max(inv.amount - paid, 0),
      status: inv.status,
      property: inv.lease.unit.property.name,
      unitLabel: inv.lease.unit.label,
      city: inv.lease.unit.property.city,
    };
  });

  const outstanding = rows.reduce((sum, r) => sum + r.outstanding, 0);
  return { rows, total: rows.length, outstanding };
}

// ── Read one (tenancy-checked) ───────────────────────────────────────────────

export type MyBillPayment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  providerRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

export type MyBillLineItemReading = {
  previousValue: number | null; // null if this was the unit's first-ever reading
  currentValue: number;
  readingDate: Date;
  photoUrl: string | null;
};

export type MyBillLineItem = {
  id: string;
  kind: string; // rent | water | electricity | other
  description: string | null;
  quantity: number | null; // metered consumption (m³ / kWh); null for rent
  unit: string | null; // "m³" | "kWh"
  amount: number; // cents
  reading: MyBillLineItemReading | null; // the meter reading behind this charge, if any
};

export type MyBillDetail = MyBill & {
  addressLine1: string;
  region: string | null;
  lineItems: MyBillLineItem[];
  payments: MyBillPayment[];
};

export async function getMyBill(session: SessionContext, billId: string): Promise<MyBillDetail> {
  const invoice = await db.rentInvoice.findUnique({
    where: { id: billId },
    include: {
      lease: {
        select: {
          unit: {
            select: {
              label: true,
              property: {
                select: { name: true, city: true, region: true, addressLine1: true },
              },
            },
          },
          // Included for the ownership assertion below — NOT trusted from input.
          tenancies: { select: { userId: true } },
        },
      },
      lineItems: {
        orderBy: { createdAt: "asc" },
        include: {
          meterReading: {
            select: { unitId: true, kind: true, value: true, readingDate: true, photoUrl: true },
          },
        },
      },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  // Assert the caller is a tenant on this bill's lease AFTER findUnique — the
  // load-bearing scoping check. A bill they're not on is reported as not found.
  if (!invoice || !invoice.lease.tenancies.some((t) => t.userId === session.userId)) {
    throw new NotFoundError("Bill not found");
  }

  const paid = invoice.payments
    .filter((p) => p.status === "succeeded")
    .reduce((sum, p) => sum + p.amount, 0);

  const prop = invoice.lease.unit.property;
  return {
    id: invoice.id,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    paid,
    outstanding: Math.max(invoice.amount - paid, 0),
    status: invoice.status,
    property: prop.name,
    unitLabel: invoice.lease.unit.label,
    city: prop.city,
    region: prop.region,
    addressLine1: prop.addressLine1,
    lineItems: await Promise.all(
      invoice.lineItems.map(async (li) => {
        let reading: MyBillLineItemReading | null = null;
        if (li.meterReading) {
          // The reading behind this charge doesn't carry its own "previous
          // value" — look up the immediately-prior reading for the same
          // unit+kind, same as the landlord-side delta computation.
          const prior = await db.meterReading.findFirst({
            where: {
              unitId: li.meterReading.unitId,
              kind: li.meterReading.kind,
              readingDate: { lt: li.meterReading.readingDate },
            },
            orderBy: { readingDate: "desc" },
            select: { value: true },
          });
          reading = {
            previousValue: prior?.value ?? null,
            currentValue: li.meterReading.value,
            readingDate: li.meterReading.readingDate,
            photoUrl: li.meterReading.photoUrl,
          };
        }
        return {
          id: li.id,
          kind: li.kind,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          amount: li.amount,
          reading,
        };
      }),
    ),
    payments: invoice.payments.map((p) => ({
      id: p.id,
      amount: p.amount,
      method: p.method,
      status: p.status,
      providerRef: p.providerRef,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    })),
  };
}
