import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import webPush, { type RequestOptions, type SendResult } from 'web-push';

import { env } from '../env.js';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  topic: string;
}

export type PushDeliveryOutcome =
  | { status: 'sent'; statusCode: number }
  | { status: 'gone'; statusCode: number; reason: string }
  | { status: 'error'; statusCode: number | null; reason: string }
  | { status: 'disabled' };

/**
 * Thin wrapper around the `web-push` package. Exists so the
 * notifications send worker can be unit-tested with a deterministic
 * stub instead of monkey-patching the package's module exports.
 *
 * VAPID keys are read once at boot — see {@link onModuleInit}. When
 * they're missing the sender stays in a `disabled` state and the
 * worker logs a single warning instead of throwing on every dispatch.
 */
@Injectable()
export class PushSender implements OnModuleInit {
  private readonly logger = new Logger(PushSender.name);
  private vapidConfigured = false;

  onModuleInit(): void {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
      this.logger.warn('VAPID keys not configured — web push fanout disabled');
      return;
    }
    webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    this.vapidConfigured = true;
  }

  get enabled(): boolean {
    return this.vapidConfigured;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushDeliveryOutcome> {
    if (!this.vapidConfigured) return { status: 'disabled' };
    try {
      const result: SendResult = await webPush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 } satisfies RequestOptions,
      );
      return { status: 'sent', statusCode: result.statusCode };
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode ?? null;
      const reason = err instanceof Error ? err.message : String(err);
      // 404 / 410 mean the subscription is gone — caller will prune.
      if (statusCode === 404 || statusCode === 410) {
        return { status: 'gone', statusCode, reason };
      }
      return { status: 'error', statusCode, reason };
    }
  }
}
