// FAT service: generate a rent invoice for a lease. Rent comes from the lease;
// metered utilities are priced as consumption × the org's current OrgUtilityRate.
// Consumption comes from a recorded MeterReading (preferred — the delta from its
// prior reading) when a *ReadingId is given, else from a manually-typed number
// (fallback for units with no reading history yet). Scopes by
// session.organizationId ONLY. Money is integer cents.

import { db } from "@repo/db";
import type { InvoiceStatus } from "@repo/db";
import { ConflictError, formatMoney, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";
import { formatNotificationDate, notifyLeaseTenants } from "./notification.service";

const generateSchema = z.object({
  leaseId: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  dueDate: z.string().datetime(),
  waterConsumption: z.coerce.number().min(0).optional(), // m³ (manual fallback)
  electricityConsumption: z.coerce.number().min(0).optional(), // kWh (manual fallback)
  waterReadingId: z.string().min(1).optional(), // preferred: derive from a recorded reading
  electricityReadingId: z.string().min(1).optional(),
});

type LineItemInput = {
  kind: "rent" | "water" | "electricity";
  description: string;
  quantity?: number;
  unit?: string;
  amount: number;
};

export async function generateInvoice(session: SessionContext, raw: unknown) {
  const input = generateSchema.parse(raw);
  if (new Date(input.periodEnd) <= new Date(input.periodStart)) {
    throw new Error("END_BEFORE_START");
  }

  // Multi-tenant guard: the lease must belong to the caller's org. A cross-org
  // lease is reported as "not found" so we don't leak its existence.
  const lease = await db.lease.findUnique({
    where: { id: input.leaseId },
    select: {
      id: true,
      unitId: true,
      organizationId: true,
      rentAmount: true,
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });
  if (!lease) throw new Error("LEASE_NOT_FOUND");
  if (lease.organizationId !== session.organizationId) {
    throw new NotFoundError("Lease not found");
  }

  // Current per-org utility rates (set by the owner within the admin bounds).
  const rates = await db.orgUtilityRate.findMany({
    where: { organizationId: session.organizationId },
  });
  const rateFor = (kind: "water" | "electricity") => rates.find((r) => r.kind === kind);

  // A *ReadingId resolves to the delta from its immediately-prior reading; a
  // manual number is the fallback when no reading history exists yet.
  // (Captured as a plain string — TS can't narrow `lease` as non-null across
  // the closure boundary below, since it's a nested function declaration.)
  const leaseUnitId = lease.unitId;
  async function resolveConsumption(
    kind: "water" | "electricity",
    manual: number | undefined,
    readingId: string | undefined,
  ): Promise<number | undefined> {
    if (!readingId) return manual;

    const reading = await db.meterReading.findUnique({ where: { id: readingId } });
    if (
      !reading ||
      reading.organizationId !== session.organizationId ||
      reading.unitId !== leaseUnitId ||
      reading.kind !== kind
    ) {
      throw new NotFoundError("Meter reading not found");
    }
    if (reading.lineItemId) throw new ConflictError("This reading has already been billed");
    if (reading.isReset) {
      throw new ConflictError(
        "This reading is a meter-reset baseline — record another reading after it before billing usage",
      );
    }

    const prior = await db.meterReading.findFirst({
      where: { unitId: reading.unitId, kind, readingDate: { lt: reading.readingDate } },
      orderBy: { readingDate: "desc" },
    });
    if (!prior) {
      throw new ConflictError(
        `No earlier ${kind} reading to compute consumption from — record a baseline reading first`,
      );
    }
    return reading.value - prior.value;
  }

  // Rent always; each metered utility only when consumption resolves to > 0.
  const lineItems: LineItemInput[] = [
    { kind: "rent", description: "Monthly rent", amount: lease.rentAmount },
  ];
  // Tracks which MeterReading (if any) backs each metered line item, so it can
  // be stamped "billed" once the invoice + line items exist.
  const readingLinks: { kind: "water" | "electricity"; readingId: string }[] = [];

  const meter = async (
    kind: "water" | "electricity",
    label: string,
    manual: number | undefined,
    readingId: string | undefined,
  ) => {
    const consumption = await resolveConsumption(kind, manual, readingId);
    if (consumption == null || consumption <= 0) return;
    const rate = rateFor(kind);
    if (!rate) throw new ConflictError(`No ${kind} rate is set for your organization`);
    lineItems.push({
      kind,
      description: label,
      quantity: consumption,
      unit: rate.unit,
      amount: Math.round(consumption * rate.pricePerUnit),
    });
    if (readingId) readingLinks.push({ kind, readingId });
  };
  await meter("water", "Water", input.waterConsumption, input.waterReadingId);
  await meter(
    "electricity",
    "Electricity",
    input.electricityConsumption,
    input.electricityReadingId,
  );

  const amount = lineItems.reduce((sum, li) => sum + li.amount, 0);

  // Duplicate (leaseId, periodStart) surfaces as Prisma P2002 → 409 in the
  // mapper. Creating the invoice, stamping its readings "billed", and notifying
  // the tenants happen in one transaction so a reading can never be linked to a
  // half-created invoice and a tenant is never told about an invoice that
  // failed to save.
  return db.$transaction(async (tx) => {
    const invoice = await tx.rentInvoice.create({
      data: {
        organizationId: session.organizationId,
        leaseId: lease.id,
        periodStart: new Date(input.periodStart),
        periodEnd: new Date(input.periodEnd),
        dueDate: new Date(input.dueDate),
        amount,
        status: "open",
        lineItems: { create: lineItems },
      },
      include: { lineItems: { orderBy: { createdAt: "asc" } } },
    });

    for (const { kind, readingId } of readingLinks) {
      const lineItem = invoice.lineItems.find((li) => li.kind === kind);
      if (lineItem) {
        await tx.meterReading.update({
          where: { id: readingId },
          data: { lineItemId: lineItem.id },
        });
      }
    }

    // Lease ownership was asserted above, so this can't fan out cross-org.
    await notifyLeaseTenants(tx, lease.id, {
      type: "invoice_created",
      title: `New rent invoice: ${formatMoney(amount)}`,
      body: `${lease.unit.property.name} · ${lease.unit.label} — due ${formatNotificationDate(invoice.dueDate)}`,
      deepLink: `/my-bills/${invoice.id}`,
    });

    return invoice;
  });
}

// ── Status transitions ───────────────────────────────────────────────────────
// Manual bookkeeping until payments are wired up: staff mark an invoice
// partially paid / paid / overdue / void. Paid and void are terminal. Tenants
// on the lease are told in the same transaction as the write.

const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["open", "void"],
  open: ["partially_paid", "paid", "overdue", "void"],
  partially_paid: ["paid", "overdue", "void"],
  overdue: ["partially_paid", "paid", "void"],
  paid: [],
  void: [],
};

const setInvoiceStatusSchema = z.object({
  status: z.enum(["open", "partially_paid", "paid", "overdue", "void"]),
});

const INVOICE_STATUS_TITLES: Record<z.infer<typeof setInvoiceStatusSchema>["status"], string> = {
  open: "Invoice issued",
  partially_paid: "Partial payment recorded",
  paid: "Invoice paid",
  overdue: "Invoice overdue",
  void: "Invoice cancelled",
};

export async function setInvoiceStatus(session: SessionContext, invoiceId: string, raw: unknown) {
  const { status } = setInvoiceStatusSchema.parse(raw);

  const invoice = await db.rentInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      lease: {
        select: {
          id: true,
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!invoice || invoice.organizationId !== session.organizationId) {
    throw new NotFoundError("Invoice not found");
  }
  if (invoice.status === status) return invoice;
  if (!INVOICE_TRANSITIONS[invoice.status].includes(status)) {
    throw new ConflictError(
      `A ${invoice.status.replace("_", " ")} invoice can't be marked ${status.replace("_", " ")}`,
    );
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.rentInvoice.update({
      where: { id: invoice.id },
      data: { status },
    });
    await notifyLeaseTenants(tx, invoice.lease.id, {
      type: "invoice_status_changed",
      title: `${INVOICE_STATUS_TITLES[status]}: ${formatMoney(invoice.amount)}`,
      body: `${invoice.lease.unit.property.name} · ${invoice.lease.unit.label} — due ${formatNotificationDate(invoice.dueDate)}`,
      deepLink: `/my-bills/${invoice.id}`,
    });
    return updated;
  });
}
