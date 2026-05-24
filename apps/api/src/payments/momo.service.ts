import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { env } from '../env.js';
import {
  buildCreateRequest,
  postCreate,
  verifyIpnSignature,
  type MomoCreateResponse,
  type MomoIpnBody,
} from './momo.client.js';

/**
 * NestJS-DI facade over the pure MoMo helpers — mirror of
 * {@link import('./vnpay.service').VnpayService}. Exists so
 * `PaymentsService` + `WebhooksService` can mock `createCheckout` and
 * `verifyIpn` in unit specs without touching the env or HMAC.
 */
@Injectable()
export class MomoService {
  /** True when all three credentials are set; controller maps to 503 otherwise. */
  isEnabled(): boolean {
    return Boolean(env.MOMO_PARTNER_CODE && env.MOMO_ACCESS_KEY && env.MOMO_SECRET_KEY);
  }

  /**
   * POSTs a signed create-payment request to MoMo and returns the
   * parsed response. Caller (`PaymentsService.createMomoCheckoutForTenant`)
   * is responsible for checking `resultCode === 0` and reading
   * `payUrl`.
   */
  async createCheckout(args: {
    /** Local Payment row id; becomes MoMo's `orderId`. */
    orderId: string;
    /** Bill amount in VND đồng (minor units). */
    amount: number;
    orderInfo: string;
    /** Browser redirect URL after the payment. */
    redirectUrl: string;
    /** Server-to-server IPN URL. */
    ipnUrl: string;
    /** UI locale for the hosted page. */
    lang?: 'vi' | 'en';
  }): Promise<MomoCreateResponse> {
    if (!env.MOMO_PARTNER_CODE || !env.MOMO_ACCESS_KEY || !env.MOMO_SECRET_KEY) {
      throw new Error('MoMo not configured — PARTNER_CODE / ACCESS_KEY / SECRET_KEY unset.');
    }
    const body = buildCreateRequest({
      partnerCode: env.MOMO_PARTNER_CODE,
      accessKey: env.MOMO_ACCESS_KEY,
      secretKey: env.MOMO_SECRET_KEY,
      requestId: randomUUID(),
      orderId: args.orderId,
      amount: args.amount,
      orderInfo: args.orderInfo,
      redirectUrl: args.redirectUrl,
      ipnUrl: args.ipnUrl,
      lang: args.lang ?? 'vi',
    });
    return postCreate(env.MOMO_CREATE_URL, body);
  }

  verifyIpn(body: MomoIpnBody): boolean {
    if (!env.MOMO_ACCESS_KEY || !env.MOMO_SECRET_KEY) return false;
    return verifyIpnSignature(body, env.MOMO_ACCESS_KEY, env.MOMO_SECRET_KEY);
  }
}
