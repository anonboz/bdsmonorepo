import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import type { NotificationTopic } from '@repo/shared';

import { renderNotification, type NotificationData } from './notifications.templates.js';
import { MailerService } from '../common/mailer/mailer.service.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import {
  JOB_NOTIFICATIONS_SEND,
  QUEUE_NOTIFICATIONS_SEND,
  type NotificationsSendJobData,
} from '../queues/queue-names.js';

/**
 * Pulls `notifications.send` jobs, renders the email per
 * {@link renderNotification}, sends via {@link MailerService}, and
 * marks the row `sentAt` on success. BullMQ retries on throw; the
 * `onFailedJob` hook lands the final error message on
 * `Notification.failureReason` so ops can grep one table.
 */
@Injectable()
@Processor(QUEUE_NOTIFICATIONS_SEND)
export class NotificationsSendWorker extends WorkerHost {
  private readonly logger = new Logger(NotificationsSendWorker.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly mailer: MailerService,
  ) {
    super();
  }

  override async process(job: Job<NotificationsSendJobData>): Promise<{ status: string }> {
    if (job.name !== JOB_NOTIFICATIONS_SEND) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_NOTIFICATIONS_SEND}`);
      return { status: 'skipped' };
    }
    const row = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
      include: { user: { select: { email: true } } },
    });
    if (!row) {
      this.logger.warn(`notification ${job.data.notificationId} not found — dropping`);
      return { status: 'not-found' };
    }
    if (row.sentAt) {
      // Idempotent: a retry or stuck job won't re-send.
      return { status: 'already-sent' };
    }
    if (!row.user.email) {
      this.logger.warn(`notification ${row.id} recipient has no email — dropping`);
      // Don't set failureReason; "no email" isn't a delivery failure
      // we should grep for as a stuck row.
      return { status: 'no-email' };
    }

    const topic = row.topic as NotificationTopic;
    const data = (row.data ?? {}) as NotificationData;
    const { emailHtml, emailText } = renderNotification(topic, data);
    await this.mailer.send({
      to: row.user.email,
      subject: row.title,
      html: emailHtml,
      text: emailText,
    });
    await this.prisma.notification.update({
      where: { id: row.id },
      data: { sentAt: new Date() },
    });
    return { status: 'sent' };
  }

  /**
   * BullMQ Worker `failed` event handler. Fires after `attemptsMade`
   * hits `opts.attempts`. Persists the error reason so ops greps one
   * table instead of digging into Redis.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<NotificationsSendJobData>, err: Error): Promise<void> {
    if (!job?.opts?.attempts || job.attemptsMade < job.opts.attempts) {
      // Will retry; don't pollute failureReason yet.
      return;
    }
    const id = job.data.notificationId;
    this.logger.error(`notification ${id} failed past max retries: ${err.message}`);
    await this.prisma.notification
      .updateMany({
        where: { id, sentAt: null },
        data: { failureReason: err.message.slice(0, 2000) },
      })
      .catch(() => {
        // updateMany of a non-existent row returns count:0, doesn't
        // throw — but Prisma errors do (connection lost, etc).
        // Swallow because we're already in a failure path.
      });
  }
}
