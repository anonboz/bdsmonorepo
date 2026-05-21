import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  NotificationTopic,
  type Bill,
  type BillLine,
  type CreateCheckoutSessionResponse,
  type Page,
  type Payment,
  type RecordPaymentResponse,
  type Role,
} from '@repo/shared';

import type { RecordManualPaymentDto } from './dto/payments.dto.js';
import { StripeService } from './stripe.service.js';
import { VnpayService } from './vnpay.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { env } from '../env.js';
import { NotificationsService } from '../notifications/notifications.service.js';

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
    private readonly stripe: StripeService,
    private readonly vnpay: VnpayService,
    private readonly notifications: NotificationsService,
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
      const { payment, bill, enqueue } = await this.prisma.$transaction(async (tx) => {
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

        // Only fire bill.paid when this payment closes the bill —
        // partial-pay states stay silent so we don't spam the tenant
        // with one email per installment.
        let enqueue: (() => Promise<void>) | null = null;
        if (nextStatus === 'PAID') {
          const lease = await tx.lease.findUnique({
            where: { id: leaseId },
            select: { tenantId: true },
          });
          if (lease) {
            const dispatch = await this.notifications.dispatch(tx, {
              topic: NotificationTopic.BILL_PAID,
              recipientId: lease.tenantId,
              data: {
                billId,
                amount: input.amount,
                currency: input.currency,
                provider: 'MANUAL',
              },
            });
            enqueue = dispatch.enqueue;
          }
        }

        return { payment: created, bill: updated, enqueue };
      });

      if (enqueue) await enqueue();
      return { payment: this.toPaymentResponse(payment), bill: this.toBillResponse(bill) };
    } catch (err) {
      if (err instanceof ProblemError) throw err;
      throw err;
    }
  }

  // ---- Stripe Checkout (tenant) -----------------------------------

  /**
   * Creates a Stripe Checkout Session for the tenant's outstanding
   * balance on the bill. The session is created *before* the local
   * Payment row insert so we can write the row with the session id
   * as `providerRef`. Stripe garbage-collects the session if our
   * insert later fails — no manual cleanup needed.
   *
   * The Bill stays in its current state. 7.3's webhook flips it to
   * `PAID` when `payment_intent.succeeded` lands.
   */
  async createStripeCheckoutForTenant(
    tenantId: string,
    tenantEmail: string | null,
    billId: string,
    ctx: RequestContext,
  ): Promise<CreateCheckoutSessionResponse> {
    if (!this.stripe.isEnabled()) {
      throw new ProblemError({
        status: 503,
        type: ErrorCodes.PAYMENT_PROVIDER_DISABLED,
        title: 'Stripe is not configured on this deployment',
      });
    }

    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        leaseId: true,
        status: true,
        currency: true,
        total: true,
        periodStart: true,
        periodEnd: true,
        lease: { select: { tenantId: true } },
      },
    });
    if (bill?.lease.tenantId !== tenantId) throw this.billNotFound();

    if (bill.status === 'PAID') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_BILL_ALREADY_PAID,
        title: 'Bill is already paid',
      });
    }
    if (!PAYABLE_STATES.has(bill.status)) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_BILL_NOT_PAYABLE,
        title: 'Bill is not payable',
        detail: `Cannot start checkout for a bill in ${bill.status} state.`,
      });
    }

    const agg = await this.prisma.payment.aggregate({
      where: { billId, status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const outstanding = bill.total - (agg._sum.amount ?? 0);
    if (outstanding <= 0) {
      // Race: a MANUAL payment landed between bill.status read and
      // this aggregation. Treat as "already paid" so the tenant
      // doesn't double-charge.
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_BILL_ALREADY_PAID,
        title: 'Bill is already paid',
      });
    }

    const description = `Rent ${bill.periodStart.toISOString().slice(0, 10)} – ${bill.periodEnd
      .toISOString()
      .slice(0, 10)}`;

    // We need the local Payment row's id in Stripe's session metadata
    // so the 7.3 webhook can resolve it without a table scan. Insert
    // the row first with `providerRef: null` (Postgres treats multiple
    // NULLs as distinct under the @@unique([provider, providerRef])
    // constraint), then update with the real session id after Stripe.
    const payment = await this.prisma.payment.create({
      data: {
        billId,
        amount: outstanding,
        currency: bill.currency,
        status: 'PENDING',
        provider: 'STRIPE',
        providerRef: null,
        note: null,
        receivedAt: null,
      },
    });

    let session;
    try {
      session = await this.stripe.createCheckoutSession({
        customerEmail: tenantEmail,
        billId: bill.id,
        tenantId,
        paymentId: payment.id,
        description,
        amount: outstanding,
        currency: bill.currency,
        successUrl: `${env.TENANT_APP_URL}/my-bills/${bill.id}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${env.TENANT_APP_URL}/my-bills/${bill.id}/payment-cancelled`,
      });
    } catch (err) {
      // Roll back the placeholder row so we don't accumulate orphans.
      await this.prisma.payment.delete({ where: { id: payment.id } }).catch(() => {
        // Ignore — we'd rather surface the Stripe error than mask it.
      });
      throw err;
    }

    if (!session.url) {
      // Stripe gives null when the session was created in a mode that
      // doesn't return a hosted URL — shouldn't happen for mode:'payment'.
      await this.prisma.payment.delete({ where: { id: payment.id } }).catch(() => undefined);
      throw new ProblemError({
        status: 500,
        type: ErrorCodes.INTERNAL_ERROR,
        title: 'Stripe returned no checkout URL',
      });
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: session.id },
    });

    await this.audit.writeOnce({
      actorId: ctx.actorId,
      action: 'bill.checkout.start',
      target: `Payment:${payment.id}`,
      meta: {
        billId,
        amount: outstanding,
        currency: bill.currency,
        provider: 'STRIPE',
        sessionId: session.id,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { url: session.url, sessionId: session.id, paymentId: payment.id };
  }

  // ---- VNPay Checkout (tenant) ------------------------------------

  /**
   * Builds a signed VNPay payment URL for the tenant's outstanding
   * balance on the bill. Inserts a PENDING Payment row before
   * returning the URL so the IPN (7.4) has a row to find.
   *
   * VNPay only supports VND, so bills in any other currency 422 with
   * `payments.currency_mismatch`. The 7.5 refund flow has its own
   * provider check.
   */
  async createVnpayCheckoutForTenant(
    tenantId: string,
    billId: string,
    ipAddress: string,
    ctx: RequestContext,
  ): Promise<CreateCheckoutSessionResponse> {
    if (!this.vnpay.isEnabled()) {
      throw new ProblemError({
        status: 503,
        type: ErrorCodes.PAYMENT_PROVIDER_DISABLED,
        title: 'VNPay is not configured on this deployment',
      });
    }

    const bill = await this.prisma.bill.findUnique({
      where: { id: billId },
      select: {
        id: true,
        leaseId: true,
        status: true,
        currency: true,
        total: true,
        periodStart: true,
        periodEnd: true,
        lease: { select: { tenantId: true } },
      },
    });
    if (bill?.lease.tenantId !== tenantId) throw this.billNotFound();

    if (bill.status === 'PAID') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_BILL_ALREADY_PAID,
        title: 'Bill is already paid',
      });
    }
    if (!PAYABLE_STATES.has(bill.status)) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_BILL_NOT_PAYABLE,
        title: 'Bill is not payable',
        detail: `Cannot start checkout for a bill in ${bill.status} state.`,
      });
    }
    if (bill.currency !== 'VND') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_CURRENCY_MISMATCH,
        title: 'Currency mismatch',
        detail: 'VNPay only supports VND.',
      });
    }

    const agg = await this.prisma.payment.aggregate({
      where: { billId, status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const outstanding = bill.total - (agg._sum.amount ?? 0);
    if (outstanding <= 0) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_BILL_ALREADY_PAID,
        title: 'Bill is already paid',
      });
    }

    // Create the Payment row first so its cuid id becomes vnp_TxnRef.
    // No external API call to dirty before this — VNPay URLs are
    // built locally, then handed to the tenant for redirect.
    const payment = await this.prisma.payment.create({
      data: {
        billId,
        amount: outstanding,
        currency: 'VND',
        status: 'PENDING',
        provider: 'VNPAY',
        providerRef: null,
        note: null,
        receivedAt: null,
      },
    });

    // Use the row's own id as the VNPay TxnRef. cuid collision
    // probability ≈ 0; the @@unique([provider, providerRef]) on
    // Payment guarantees we never reuse one.
    const txnRef = payment.id;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: txnRef },
    });

    const orderInfo = `Rent ${bill.periodStart.toISOString().slice(0, 10)} - ${bill.periodEnd
      .toISOString()
      .slice(0, 10)}`;
    const returnUrl = `${env.TENANT_APP_URL}/my-bills/${bill.id}/vnpay/return`;

    const url = this.vnpay.buildCheckoutUrl({
      txnRef,
      amount: outstanding,
      orderInfo,
      returnUrl,
      ipAddress,
    });

    await this.audit.writeOnce({
      actorId: ctx.actorId,
      action: 'bill.checkout.start',
      target: `Payment:${payment.id}`,
      meta: {
        billId,
        amount: outstanding,
        currency: 'VND',
        provider: 'VNPAY',
        txnRef,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return { url, sessionId: txnRef, paymentId: payment.id };
  }

  // ---- Refunds (owner) --------------------------------------------

  /**
   * Owner-issued refund of a SUCCEEDED Payment. Inserts a new Payment
   * row with `amount = -input.amount`, links it via
   * `refundOfPaymentId`, and recomputes the bill — refunds net out of
   * `SUM(SUCCEEDED.amount)` naturally because the column is signed.
   *
   * Provider behavior:
   *   - MANUAL: local row only. Owner has already moved the money
   *     back out-of-band.
   *   - STRIPE: calls `stripe.refunds.create({ payment_intent })`.
   *     Requires `providerCaptureRef` (the PaymentIntent id we
   *     captured in the 7.3 webhook).
   *   - VNPAY: 501 `payments.refund_not_supported`. VNPay's refund
   *     API is out of scope for v1 — owners process through the
   *     VNPay dashboard, then record a MANUAL refund here for books.
   */
  async refundForOwner(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
    billId: string,
    paymentId: string,
    input: { amount: number; reason?: string },
    ctx: RequestContext,
  ): Promise<RecordPaymentResponse> {
    await this.assertOwnerOfLease(actor, houseId, unitId, leaseId);

    const original = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (original?.billId !== billId) throw this.billNotFound();

    if (original.status !== 'SUCCEEDED' || original.amount <= 0) {
      // Reject refunds of PENDING, FAILED, REFUNDED, CANCELLED rows AND
      // refund-of-refund attempts (negative-amount rows).
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_NOT_REFUNDABLE,
        title: 'Payment is not refundable',
        detail: `Only SUCCEEDED charges with positive amounts can be refunded; this is ${original.status} (amount=${original.amount}).`,
      });
    }

    // Sum of all refund rows already issued against this original.
    // Returns a non-positive number (negative-summing toward zero).
    const refundAgg = await this.prisma.payment.aggregate({
      where: { refundOfPaymentId: original.id, status: 'SUCCEEDED' },
      _sum: { amount: true },
    });
    const alreadyRefunded = refundAgg._sum.amount ?? 0; // ≤ 0
    const refundable = original.amount + alreadyRefunded;
    if (input.amount > refundable) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYMENT_REFUND_EXCEEDS_REMAINING,
        title: 'Refund exceeds remaining balance on this payment',
        detail: `Refundable balance on payment ${paymentId} is ${refundable} ${original.currency}; refund was ${input.amount}.`,
      });
    }

    // Provider-side refund call BEFORE we insert the local row — if
    // the provider rejects, we don't want a phantom refund on the
    // books. MANUAL has no provider call.
    let providerRefundRef: string | null = null;
    switch (original.provider) {
      case 'MANUAL':
        break;
      case 'STRIPE': {
        if (!this.stripe.isEnabled()) {
          throw new ProblemError({
            status: 503,
            type: ErrorCodes.PAYMENT_PROVIDER_DISABLED,
            title: 'Stripe is not configured on this deployment',
          });
        }
        if (!original.providerCaptureRef) {
          throw new ProblemError({
            status: 422,
            type: ErrorCodes.PAYMENT_REFUND_MISSING_CAPTURE_REF,
            title: 'Stripe PaymentIntent missing for this payment',
            detail:
              'This Stripe payment landed before we captured the PaymentIntent id. Refund via the Stripe dashboard, then record a MANUAL refund here.',
          });
        }
        const refund = await this.stripe.createRefund({
          paymentIntentId: original.providerCaptureRef,
          amount: input.amount,
          reason: 'requested_by_customer',
          metadata: { billId, originalPaymentId: original.id },
        });
        providerRefundRef = refund.id;
        break;
      }
      case 'VNPAY':
        throw new ProblemError({
          status: 501,
          type: ErrorCodes.PAYMENT_REFUND_NOT_SUPPORTED,
          title: 'VNPay refunds are not supported',
          detail:
            'Process the refund via the VNPay dashboard, then record a MANUAL refund here so the bill stays in sync.',
        });
      case 'MOMO':
        throw new ProblemError({
          status: 501,
          type: ErrorCodes.PAYMENT_REFUND_NOT_SUPPORTED,
          title: 'MoMo refunds are not supported',
        });
    }

    const {
      payment: refundRow,
      bill: updatedBill,
      enqueue,
    } = await this.prisma.$transaction(async (tx) => {
      // Lock the bill row so a concurrent record-payment doesn't
      // race with the recompute. Same belt as 7.1.
      await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;

      const created = await tx.payment.create({
        data: {
          billId,
          amount: -input.amount,
          currency: original.currency,
          status: 'SUCCEEDED',
          provider: original.provider,
          providerRef: providerRefundRef,
          providerCaptureRef: null,
          note: input.reason ?? null,
          receivedAt: new Date(),
          refundOfPaymentId: original.id,
        },
      });

      // Recompute the bill from scratch. The signed sum nets refunds
      // automatically; we just decide PAID vs PARTIALLY_PAID vs
      // ISSUED based on the net total.
      const agg = await tx.payment.aggregate({
        where: { billId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      });
      const sum = agg._sum.amount ?? 0;
      const billRow = await tx.bill.findUnique({
        where: { id: billId },
        ...BILL_WITH_LINES,
      });
      if (!billRow) throw this.billNotFound();
      const previousStatus = billRow.status;
      const nextStatus: typeof billRow.status =
        sum <= 0 ? 'ISSUED' : sum >= billRow.total ? 'PAID' : 'PARTIALLY_PAID';
      const bill = await tx.bill.update({
        where: { id: billId },
        data: { status: nextStatus },
        ...BILL_WITH_LINES,
      });

      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'bill.payment.refund',
        target: `Payment:${created.id}`,
        meta: {
          originalPaymentId: original.id,
          amount: input.amount,
          currency: original.currency,
          provider: original.provider,
          providerRefundRef,
          billPreviousStatus: previousStatus,
          billNextStatus: nextStatus,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      const lease = await tx.lease.findUnique({
        where: { id: leaseId },
        select: { tenantId: true },
      });
      const dispatch = lease
        ? await this.notifications.dispatch(tx, {
            topic: NotificationTopic.BILL_REFUNDED,
            recipientId: lease.tenantId,
            data: {
              billId,
              originalPaymentId: original.id,
              amount: input.amount,
              currency: original.currency,
              provider: original.provider,
            },
          })
        : null;

      return { payment: created, bill, enqueue: dispatch?.enqueue ?? null };
    });

    if (enqueue) await enqueue();
    return { payment: this.toPaymentResponse(refundRow), bill: this.toBillResponse(updatedBill) };
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
      providerCaptureRef: row.providerCaptureRef,
      note: row.note,
      receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
      failureReason: row.failureReason,
      refundOfPaymentId: row.refundOfPaymentId,
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
