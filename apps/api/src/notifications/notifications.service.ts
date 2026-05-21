import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';

import type { NotificationTopic } from '@repo/shared';

import { renderNotification, type NotificationData } from './notifications.templates.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import {
  JOB_NOTIFICATIONS_SEND,
  QUEUE_NOTIFICATIONS_SEND,
  type NotificationsSendJobData,
} from '../queues/queue-names.js';

export interface DispatchInput {
  topic: NotificationTopic;
  recipientId: string;
  data: NotificationData;
}

/**
 * Fans state-transition events out to the `Notification` table + the
 * `notifications.send` BullMQ queue. Phase 8.1's MailerService is the
 * downstream sender; this service owns row persistence + topic
 * template lookup + the post-tx enqueue.
 *
 * Callers from inside a Prisma `$transaction` use {@link dispatch} +
 * supply an `enqueueAfterCommit` callback they'll invoke after the
 * tx returns. Callers without a tx use {@link dispatchAndEnqueue}.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    @InjectQueue(QUEUE_NOTIFICATIONS_SEND) private readonly queue: Queue<NotificationsSendJobData>,
  ) {}

  /**
   * Persists a Notification row inside the caller's transaction. The
   * caller is responsible for invoking the returned enqueue function
   * AFTER the tx commits — see the §5 dispatch flow in
   * docs/specs/phase8-notification-fanout.md.
   */
  async dispatch(
    tx: Prisma.TransactionClient,
    input: DispatchInput,
  ): Promise<{ id: string; enqueue: () => Promise<void> }> {
    const { title, body } = renderNotification(input.topic, input.data);
    const row = await tx.notification.create({
      data: {
        userId: input.recipientId,
        channel: 'EMAIL',
        topic: input.topic,
        title,
        body,
        data: input.data as Prisma.InputJsonValue,
      },
    });
    const id = row.id;
    return {
      id,
      enqueue: async () => {
        try {
          await this.queue.add(
            JOB_NOTIFICATIONS_SEND,
            { notificationId: id },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: 200,
              removeOnFail: 100,
            },
          );
        } catch (err) {
          // BullMQ down — row sits with sentAt: null, failureReason: null.
          // A future stuck-notifications sweeper can pick it up. Log it
          // so the next ops person sees something.
          this.logger.warn(
            `notifications.send enqueue failed for ${id}: ${(err as Error).message}`,
          );
        }
      },
    };
  }

  /**
   * Convenience: dispatch + enqueue in one shot. Wraps the insert in
   * its own short transaction. Use when the caller hasn't already
   * opened a $transaction.
   */
  async dispatchAndEnqueue(input: DispatchInput): Promise<string> {
    const { id, enqueue } = await this.prisma.$transaction(async (tx) => this.dispatch(tx, input));
    await enqueue();
    return id;
  }
}
