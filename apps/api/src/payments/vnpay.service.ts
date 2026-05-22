import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { env } from '../env.js';
import {
  buildPaymentUrl,
  buildRefundBody,
  formatVnpayDate,
  postRefund,
  verifyIpnSignature,
  type BuildPaymentUrlParams,
  type VnpayRefundResponse,
} from './vnpay.client.js';

/**
 * NestJS-DI face over the pure VNPay helpers. The single reason this
 * class exists is mockability: PaymentsService + WebhooksService both
 * call into VNPay, and unit specs need to override `buildPaymentUrl`
 * (deterministic URL) and `verifyIpnSignature` (no real HMAC) without
 * touching the env or the `node:crypto` calls.
 */
@Injectable()
export class VnpayService {
  /** True when both env vars are set; controller maps to 503 otherwise. */
  isEnabled(): boolean {
    return Boolean(env.VNPAY_TMN_CODE && env.VNPAY_HASH_SECRET);
  }

  buildCheckoutUrl(args: {
    txnRef: string;
    /** Bill amount in VND đồng (minor units). VNPay multiplies internally. */
    amount: number;
    orderInfo: string;
    returnUrl: string;
    ipAddress: string;
  }): string {
    if (!env.VNPAY_TMN_CODE || !env.VNPAY_HASH_SECRET) {
      throw new Error('VNPay not configured — TMN_CODE or HASH_SECRET unset.');
    }
    const params: BuildPaymentUrlParams = {
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
      paymentUrl: env.VNPAY_PAYMENT_URL,
      txnRef: args.txnRef,
      amount: args.amount,
      orderInfo: args.orderInfo,
      orderType: 'billpayment',
      locale: env.VNPAY_LOCALE,
      returnUrl: args.returnUrl,
      ipAddress: args.ipAddress,
    };
    return buildPaymentUrl(params);
  }

  verifyIpn(query: Record<string, string>): boolean {
    if (!env.VNPAY_HASH_SECRET) return false;
    return verifyIpnSignature(query, env.VNPAY_HASH_SECRET);
  }

  /**
   * Posts a signed refund request to VNPay's merchant_webapi. Caller
   * (PaymentsService.refundForOwner) is responsible for gating on
   * `vnp_ResponseCode === '00'`.
   *
   * `transactionDate` is the original payment's `vnp_PayDate` echoed
   * back — required by VNPay's refund signature canonical-string.
   * The IPN handler persists this onto `Payment.providerCaptureDate`
   * since Phase 9.2 (see `parseVnpayDate` in vnpay.client).
   */
  async createRefund(args: {
    /** Local Payment id of the original charge. */
    txnRef: string;
    /** Refund amount in VND đồng (minor units). */
    amount: number;
    /** VNPay's transaction no from the original IPN. */
    transactionNo: string;
    /** Original transaction date as `yyyyMMddHHmmss` (Asia/Ho_Chi_Minh). */
    transactionDate: string;
    /** `02` for full, `03` for partial. */
    transactionType: '02' | '03';
    orderInfo: string;
    createBy: string;
    ipAddress: string;
  }): Promise<VnpayRefundResponse> {
    if (!env.VNPAY_TMN_CODE || !env.VNPAY_HASH_SECRET) {
      throw new Error('VNPay not configured — TMN_CODE or HASH_SECRET unset.');
    }
    const body = buildRefundBody({
      tmnCode: env.VNPAY_TMN_CODE,
      hashSecret: env.VNPAY_HASH_SECRET,
      requestId: randomUUID(),
      txnRef: args.txnRef,
      amount: args.amount,
      transactionType: args.transactionType,
      transactionNo: args.transactionNo,
      transactionDate: args.transactionDate,
      orderInfo: args.orderInfo,
      createBy: args.createBy,
      ipAddress: args.ipAddress,
    });
    return postRefund(env.VNPAY_REFUND_URL, body);
  }

  /** Echoes the `formatVnpayDate` helper for callers that need to
   *  convert a stored `Date` to VNPay's wire format. */
  formatTransactionDate(date: Date): string {
    return formatVnpayDate(date);
  }
}
