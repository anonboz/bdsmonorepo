// FAT service: tenant-reported payments awaiting this org's confirmation.
// A tenant marks a bill as paid by cash or transfer (→ Payment.status pending);
// staff confirm (→ succeeded, invoice re-derived to paid / partially_paid) or
// reject (→ failed). Payments hang off invoices, so scoping is via
// RentInvoice.organizationId — asserted after every findUnique. Money is
// integer cents.

import { db } from "@repo/db";
import { ConflictError, formatMoney, NotFoundError } from "@repo/shared";

import type { SessionContext } from "@/lib/session";
import { formatNotificationDate, notifyLeaseTenants } from "./notification.service";

export type OrgPaymentRow = {
  id: string;
  amount: number;
  method: string; // PaymentMethod
  status: string; // PaymentStatus
  createdAt: Date;
  paidAt: Date | null;
  invoiceId: string;
  invoiceStatus: string;
  periodStart: Date;
  periodEnd: Date;
  property: string;
  unitLabel: string;
  tenant: string; // primary tenant's name/email
};

const MAX_ROWS = 100;

// ── List (pending first, then recent history) ────────────────────────────────

export async function listOrgPayments(
  session: SessionContext,
): Promise<{ rows: OrgPaymentRow[]; pending: number }> {
  const payments = await db.payment.findMany({
    where: { invoice: { organizationId: session.organizationId } }, // tenant scope
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: MAX_ROWS,
    include: {
      invoice: {
        select: {
          id: true,
          status: true,
          periodStart: true,
          periodEnd: true,
          lease: {
            select: {
              unit: { select: { label: true, property: { select: { name: true } } } },
              tenancies: {
                orderBy: { isPrimary: "desc" },
                take: 1,
                select: { user: { select: { name: true, email: true } } },
              },
            },
          },
        },
      },
    },
  });

  const rows = payments.map((p) => {
    const primary = p.invoice.lease.tenancies[0]?.user;
    return {
      id: p.id,
      amount: p.amount,
      method: p.method,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      invoiceId: p.invoice.id,
      invoiceStatus: p.invoice.status,
      periodStart: p.invoice.periodStart,
      periodEnd: p.invoice.periodEnd,
      property: p.invoice.lease.unit.property.name,
      unitLabel: p.invoice.lease.unit.label,
      tenant: primary?.name ?? primary?.email ?? "—",
    };
  });
  // "pending" sorts before "succeeded"/"failed" alphabetically, so the
  // orderBy above already floats them; count for the nav badge.
  return { rows, pending: rows.filter((r) => r.status === "pending").length };
}

// ── Confirm / reject ─────────────────────────────────────────────────────────

async function loadOwnedPending(session: SessionContext, paymentId: string) {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      invoice: {
        select: {
          id: true,
          organizationId: true,
          amount: true,
          status: true,
          dueDate: true,
          leaseId: true,
          lease: {
            select: { unit: { select: { label: true, property: { select: { name: true } } } } },
          },
        },
      },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!payment || payment.invoice.organizationId !== session.organizationId) {
    throw new NotFoundError("Payment not found");
  }
  if (payment.status !== "pending") {
    throw new ConflictError(`This payment was already ${payment.status}`);
  }
  return payment;
}

export async function confirmPayment(session: SessionContext, paymentId: string) {
  const payment = await loadOwnedPending(session, paymentId);
  const inv = payment.invoice;
  const unit = `${inv.lease.unit.property.name} · ${inv.lease.unit.label}`;

  return db.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "succeeded", paidAt: new Date() },
    });

    // Re-derive the invoice status from what has actually been settled.
    const settled = await tx.payment.aggregate({
      where: { invoiceId: inv.id, status: "succeeded" },
      _sum: { amount: true },
    });
    const paid = settled._sum.amount ?? 0;
    const nextStatus =
      inv.status === "void" ? "void" : paid >= inv.amount ? "paid" : "partially_paid";
    if (nextStatus !== inv.status) {
      await tx.rentInvoice.update({ where: { id: inv.id }, data: { status: nextStatus } });
    }

    await notifyLeaseTenants(tx, inv.leaseId, {
      type: "payment_confirmed",
      title: `Payment confirmed: ${formatMoney(payment.amount)}`,
      body:
        nextStatus === "paid"
          ? `${unit} — your bill due ${formatNotificationDate(inv.dueDate)} is now paid. Thank you!`
          : `${unit} — ${formatMoney(inv.amount - paid)} is still outstanding on the bill due ${formatNotificationDate(inv.dueDate)}.`,
      deepLink: `/my-bills/${inv.id}`,
    });

    return { id: updated.id, status: updated.status, invoiceStatus: nextStatus };
  });
}

export async function rejectPayment(session: SessionContext, paymentId: string) {
  const payment = await loadOwnedPending(session, paymentId);
  const inv = payment.invoice;
  const unit = `${inv.lease.unit.property.name} · ${inv.lease.unit.label}`;

  return db.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: "failed" },
    });
    await notifyLeaseTenants(tx, inv.leaseId, {
      type: "payment_rejected",
      title: `Payment not confirmed: ${formatMoney(payment.amount)}`,
      body: `${unit} — your landlord couldn't confirm this ${payment.method === "cash" ? "cash" : "transfer"} payment. Please check and report it again or contact them.`,
      deepLink: `/my-bills/${inv.id}`,
    });
    return { id: updated.id, status: updated.status, invoiceStatus: inv.status };
  });
}
