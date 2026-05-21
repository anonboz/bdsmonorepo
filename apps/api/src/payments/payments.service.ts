import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  type Bill,
  type BillLine,
  type Page,
  type Payment,
  type RecordPaymentResponse,
  type Role,
} from '@repo/shared';

import type { RecordManualPaymentDto } from './dto/payments.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

type BillRow = Prisma.BillGetPayload<{ include: { lines: true } }>;
type PaymentRow = Prisma.PaymentGetPayload<Record<string, never>>;

const BILL_WITH_LINES = {
  include: { lines: { orderBy: { createdAt: 'asc' } } },
} satisfies Prisma.BillDefaultArgs;

/**
 * Permitted bill states for recording a payment. `DRAFT` and `VOID`
 * are never payable; `PAID` is rejected with a more specific code.
 */
const PAYABLE_STATES = new Set<BillRow['status']>(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']);

/**
 * Payments service — Phase 7.1 ships the MANUAL provider only. Stripe
 * + VNPay land in 7.2 / 7.4 and reuse the same Payment row + bill
 * status recompute logic; the provider entry point is the only thing
 * that differs.
 *
 * Authorization mirrors the bills service: owner of the lease (or
 * admin for reads) only. Cross-party access returns 404.
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  // ---- Mutations (owner-only) -------------------------------------

  async recordManualForOwner(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
    billId: string,
    input: RecordManualPaymentDto,
    ctx: RequestContext,
  ): Promise<RecordPaymentResponse> {
    await this.assertOwnerOfLease(actor, houseId, unitId, leaseId);

    // Don't accept timestamps more than a day in the future — keeps
    // accounting workflows that pre-record cleared funds working, but
    // closes the door on nonsense like 2999-01-01.
    if (input.receivedAt) {
      const max = Date.now() + 24 * 60 * 60 * 1000;
      if (new Date(input.receivedAt).getTime() > max) {
        throw new ProblemError({
          status: 422,
          type: ErrorCodes.PAYMENT_RECEIVED_AT_FUTURE,
          title: 'receivedAt is too far in the future',
        });
      }
    }

    try {
      const { payment, bill } = await this.prisma.$transaction(async (tx) => {
        // Lock the bill row so concurrent record-payment requests
        // serialise — see the spec §10 "Concurrent record".
        await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;

        const billRow = await tx.bill.findUnique({
          where: { id: billId },
          ...BILL_WITH_LINES,
        });
        if (billRow?.leaseId !== leaseId) throw this.billNotFound();

        if (billRow.status === 'PAID') {
          throw new ProblemError({
            status: 422,
            type: ErrorCodes.PAYMENT_BILL_ALREADY_PAID,
            title: 'Bill is already paid',
          });
        }
        if (!PAYABLE_STATES.has(billRow.status)) {
          throw new ProblemError({
            status: 422,
            type: ErrorCodes.PAYMENT_BILL_NOT_PAYABLE,
            title: 'Bill is not payable',
            detail: `Cannot record a payment for a bill in ${billRow.status} state.`,
          });
        }
        if (billRow.currency !== input.currency) {
          throw new ProblemError({
            status: 422,
            type: ErrorCodes.PAYMENT_CURRENCY_MISMATCH,
            title: 'Currency mismatch',
            detail: `Bill is ${billRow.currency}; payment was ${input.currency}.`,
          });
        }

        // Sum of succeeded payments so far. Positive amounts only;
        // refunds (Phase 7.5) will be negative rows that net here.
        const agg = await tx.payment.aggregate({
          where: { billId, status: 'SUCCEEDED' },
          _sum: { amount: true },
        });
        const existing = agg._sum.amount ?? 0;
        const remaining = billRow.total - existing;
        if (input.amount > remaining) {
          throw new ProblemError({
            status: 422,
            type: ErrorCodes.PAYMENT_OVERPAYMENT,
            title: 'Payment exceeds outstanding balance',
            detail: `Outstanding balance is ${remaining}; payment was ${input.amount}.`,
          });
        }

        let created: PaymentRow;
        try {
          created = await tx.payment.create({
            data: {
              billId,
              amount: input.amount,
              currency: input.currency,
              status: 'SUCCEEDED',
              provider: 'MANUAL',
              providerRef: input.providerRef ?? null,
              note: input.note ?? null,
              receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new ProblemError({
              status: 409,
              type: ErrorCodes.PAYMENT_PROVIDER_REF_TAKEN,
              title: 'providerRef is already in use',
            });
          }
          throw err;
        }

        const nextSum = existing + input.amount;
        const nextStatus: BillRow['status'] = nextSum >= billRow.total ? 'PAID' : 'PARTIALLY_PAID';
        const updated = await tx.bill.update({
          where: { id: billId },
          data: { status: nextStatus },
          ...BILL_WITH_LINES,
        });

        await this.audit.write(tx, {
          actorId: ctx.actorId,
          action: 'bill.payment.record',
          target: `Payment:${created.id}`,
          meta: {
            billId,
            amount: input.amount,
            currency: input.currency,
            provider: 'MANUAL',
            providerRef: input.providerRef ?? null,
            billPreviousStatus: billRow.status,
            billNextStatus: nextStatus,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });

        return { payment: created, bill: updated };
      });

      return { payment: this.toPaymentResponse(payment), bill: this.toBillResponse(bill) };
    } catch (err) {
      if (err instanceof ProblemError) throw err;
      throw err;
    }
  }

  // ---- Reads -------------------------------------------------------

  async listForOwnerBill(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
    billId: string,
  ): Promise<Page<Payment>> {
    await this.assertOwnerOrAdminOfLease(actor, houseId, unitId, leaseId);
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      select: { id: true, leaseId: true },
    });
    if (bill?.leaseId !== leaseId) throw this.billNotFound();
    return this.listForBill(billId);
  }

  async listForTenantBill(tenantId: string, billId: string): Promise<Page<Payment>> {
    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      select: { id: true, lease: { select: { tenantId: true } } },
    });
    if (bill?.lease.tenantId !== tenantId) throw this.billNotFound();
    return this.listForBill(billId);
  }

  // ---- helpers -----------------------------------------------------

  private async listForBill(billId: string): Promise<Page<Payment>> {
    const rows = await this.prisma.payment.findMany({
      where: { billId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      items: rows.map((r) => this.toPaymentResponse(r)),
      nextCursor: null,
    };
  }

  private async assertOwnerOfLease(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
  ): Promise<void> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        id: true,
        unitId: true,
        ownerId: true,
        deletedAt: true,
        unit: { select: { houseId: true, deletedAt: true } },
      },
    });
    if (!lease || lease.deletedAt || lease.unitId !== unitId || lease.unit.houseId !== houseId) {
      throw this.billNotFound();
    }
    // No ADMIN bypass on the write path — admins shouldn't record
    // payments on behalf of owners (tribal-knowledge ops we avoid).
    if (actor.id !== lease.ownerId) throw this.billNotFound();
  }

  private async assertOwnerOrAdminOfLease(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
  ): Promise<void> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        id: true,
        unitId: true,
        ownerId: true,
        deletedAt: true,
        unit: { select: { houseId: true, deletedAt: true } },
      },
    });
    if (!lease || lease.deletedAt || lease.unitId !== unitId || lease.unit.houseId !== houseId) {
      throw this.billNotFound();
    }
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && actor.id !== lease.ownerId) throw this.billNotFound();
  }

  private billNotFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.BILL_NOT_FOUND,
      title: 'Bill not found',
    });
  }

  private toPaymentResponse(row: PaymentRow): Payment {
    return {
      id: row.id,
      billId: row.billId,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      provider: row.provider,
      providerRef: row.providerRef,
      note: row.note,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toBillResponse(row: BillRow): Bill {
    return {
      id: row.id,
      leaseId: row.leaseId,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      dueDate: row.dueDate.toISOString().slice(0, 10),
      issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      status: row.status,
      subtotal: row.subtotal,
      total: row.total,
      currency: row.currency,
      lines: row.lines.map(
        (l): BillLine => ({
          id: l.id,
          billId: l.billId,
          kind: l.kind,
          label: l.label,
          amount: l.amount,
          quantity: l.quantity,
          createdAt: l.createdAt.toISOString(),
        }),
      ),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
