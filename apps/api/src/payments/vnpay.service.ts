import { Injectable } from '@nestjs/common';

import { env } from '../env.js';
import { buildPaymentUrl, verifyIpnSignature, type BuildPaymentUrlParams } from './vnpay.client.js';

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
}
