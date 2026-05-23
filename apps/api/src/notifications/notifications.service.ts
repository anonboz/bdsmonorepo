import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';

import type { NotificationTopic } from '@repo/shared';

import { renderNotification, type NotificationData } from './notifications.templates.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
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

/** Sweep cap on the per-row retry counter. Past this, the sweeper
 *  finalizes the row with `failureReason` so it stops re-picking. */
export const SWEEP_MAX_RETRIES = 3;

/** Rows must be at least this old before the sweeper touches them.
 *  Long enough for the normal send path (queue → worker → mailer) to
 *  finish on a healthy day, short enough that a Redis blip doesn't
 *  delay delivery much past an hour. */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1_000; // 1 hour

export interface SweepResult {
  inspected: number;
  retried: number;
  gaveUp: number;
}

/** Shape of the rows the sweeper acts on. Narrow projection — the
 *  worker re-reads the full row when it actually sends. */
interface StuckRow {
  id: string;
  userId: string;
  topic: string;
  retryCount: number;
  createdAt: Date;
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
    private readonly audit: AuditLogger,
  ) {}

  /**
   * Persists a Notification row inside the caller's transaction. The
   * caller is responsible for invoking the returned enqueue function
   * AFTER the tx commits — see the §5 dispatch flow in
   * docs/specs/phase8-notification-fanout.md.
   *
   * Phase 9.4 / 10.4: the dispatch gate consults
   * {@link NotificationPreference} (per-scope) + {@link NotificationQuietHours}
   * before deciding what to fan out on. The result is:
   *
   *   - **Full mute** (any `scope=ALL muted=true` row): nothing persists,
   *     the returned `enqueue` is a no-op and `muted=true`. Same shape
   *     as 9.4 so existing audit-log paths don't change.
   *   - **Email-only mute**: row persists with `failureReason` set so
   *     the 10.2 sweeper leaves it alone; `enqueue` is a no-op.
   *   - **Quiet hours active**: row persists; `enqueue` schedules the
   *     send with `delay` until the window's end.
   *   - **Default**: identical to 9.4 — row persists, `enqueue` fires
   *     the BullMQ job immediately.
   */
  async dispatch(
    tx: Prisma.TransactionClient,
    input: DispatchInput,
    now: Date = new Date(),
  ): Promise<{ id: string | null; enqueue: () => Promise<void>; muted: boolean }> {
    // One findMany covers ALL / EMAIL / IN_APP scopes for the (user,
    // topic) pair. Order doesn't matter — we just need set-membership.
    const prefs = await tx.notificationPreference.findMany({
      where: { userId: input.recipientId, topic: input.topic },
      select: { scope: true, muted: true },
    });
    const fullMute = prefs.some((p) => p.scope === 'ALL' && p.muted);
    if (fullMute) {
      return { id: null, enqueue: () => Promise.resolve(), muted: true };
    }
    const emailMute = prefs.some((p) => p.scope === 'EMAIL' && p.muted);
    const inAppMute = prefs.some((p) => p.scope === 'IN_APP' && p.muted);
    if (emailMute && inAppMute) {
      // Both channels independently muted — treat like full mute.
      return { id: null, enqueue: () => Promise.resolve(), muted: true };
    }

    const quietHours = await tx.notificationQuietHours.findUnique({
      where: { userId: input.recipientId },
    });
    const delayMs = quietHours
      ? msUntilQuietHoursEnd(now, quietHours.startUtcMinute, quietHours.endUtcMinute)
      : 0;
    const inQuietHours = delayMs > 0;

    const { title, body } = renderNotification(input.topic, input.data);
    const row = await tx.notification.create({
      data: {
        userId: input.recipientId,
        channel: 'EMAIL',
        topic: input.topic,
        title,
        body,
        data: input.data as Prisma.InputJsonValue,
        // Email muted at the channel scope — finalize the row so the
        // 10.2 stuck-notifications sweeper doesn't pick it up.
        ...(emailMute && {
          failureReason: 'email channel muted by user preference',
        }),
      },
    });
    const id = row.id;
    return {
      id,
      muted: false,
      enqueue: async () => {
        if (emailMute) return;
        try {
          await this.queue.add(
            JOB_NOTIFICATIONS_SEND,
            { notificationId: id },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
              removeOnComplete: 200,
              removeOnFail: 100,
              ...(inQuietHours && { delay: delayMs }),
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
  async dispatchAndEnqueue(input: DispatchInput): Promise<string | null> {
    const { id, enqueue } = await this.prisma.$transaction(async (tx) => this.dispatch(tx, input));
    await enqueue();
    return id;
  }

  // ---- Phase 10.2 — stuck-notifications sweep ---------------------

  /**
   * Rows older than {@link SWEEP_MIN_AGE_MS} where the send pipeline
   * never finalized — `sentAt IS NULL AND failureReason IS NULL`. The
   * sweeper bumps `retryCount` per visit, finalizes with `failureReason`
   * once the counter hits {@link SWEEP_MAX_RETRIES}, and re-enqueues
   * `notifications.send` otherwise.
   *
   * Ordered by createdAt ascending so the oldest stuck rows clear first.
   */
  async findStuck(opts: { olderThan: Date; limit: number }): Promise<StuckRow[]> {
    return this.prisma.notification.findMany({
      where: {
        sentAt: null,
        failureReason: null,
        createdAt: { lt: opts.olderThan },
      },
      select: {
        id: true,
        userId: true,
        topic: true,
        retryCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
      take: opts.limit,
    });
  }

  /**
   * Sweep entry-point used by the BullMQ scheduler. Drives the
   * eligibility query + per-row bookkeeping. Provider-side enqueue
   * happens after each row's tx commits, so a failed enqueue doesn't
   * roll back the counter bump (the row would re-attempt on the next
   * sweep window anyway).
   */
  async sweepStuck(now: Date = new Date()): Promise<SweepResult> {
    const cutoff = new Date(now.getTime() - SWEEP_MIN_AGE_MS);
    const candidates = await this.findStuck({ olderThan: cutoff, limit: 100 });
    let retried = 0;
    let gaveUp = 0;
    for (const row of candidates) {
      // Re-check inside the tx: the worker may have set `sentAt` or
      // `failureReason` between the query above and the update below.
      const outcome = await this.prisma.$transaction(
        async (tx): Promise<'retry' | 'give-up' | 'raced'> => {
          const cur = await tx.notification.findUnique({
            where: { id: row.id },
            select: { id: true, sentAt: true, failureReason: true, retryCount: true },
          });
          if (!cur || cur.sentAt || cur.failureReason) return 'raced';

          const nextCount = cur.retryCount + 1;
          if (nextCount > SWEEP_MAX_RETRIES) {
            await tx.notification.update({
              where: { id: row.id },
              data: {
                failureReason: `sweep gave up after ${SWEEP_MAX_RETRIES} retries`,
                lastAttemptAt: now,
              },
            });
            await this.audit.write(tx, {
              actorId: null,
              action: 'notification.sweep.give-up',
              target: `Notification:${row.id}`,
              meta: {
                topic: row.topic,
                userId: row.userId,
                retryCount: cur.retryCount,
                ageMs: now.getTime() - row.createdAt.getTime(),
              },
            });
            return 'give-up';
          }

          await tx.notification.update({
            where: { id: row.id },
            data: { retryCount: nextCount, lastAttemptAt: now },
          });
          await this.audit.write(tx, {
            actorId: null,
            action: 'notification.sweep.retry',
            target: `Notification:${row.id}`,
            meta: {
              topic: row.topic,
              userId: row.userId,
              retryCount: nextCount,
              ageMs: now.getTime() - row.createdAt.getTime(),
            },
          });
          return 'retry';
        },
      );

      if (outcome === 'retry') {
        try {
          await this.queue.add(
            JOB_NOTIFICATIONS_SEND,
            { notificationId: row.id },
            {
              // The sweeper itself is the backoff — give BullMQ a
              // single attempt and let the next sweep window pick up
              // any failure.
              attempts: 1,
              removeOnComplete: 200,
              removeOnFail: 100,
            },
          );
          retried += 1;
        } catch (err) {
          // Redis flaked between the tx and the enqueue. The counter
          // is already bumped; next sweep will try again or, if we
          // hit SWEEP_MAX_RETRIES, finalize.
          this.logger.warn(`sweep re-enqueue failed for ${row.id}: ${(err as Error).message}`);
        }
      } else if (outcome === 'give-up') {
        gaveUp += 1;
      }
      // outcome === 'raced' is intentionally uncounted: the row finalized
      // between the query and the tx, neither retried nor gave-up here.
    }
    return { inspected: candidates.length, retried, gaveUp };
  }
}

/**
 * Returns the milliseconds remaining until the quiet-hours window
 * closes for the given `now`. Zero means we're outside the window.
 *
 * The window is inclusive of `start` and exclusive of `end`. When
 * `end < start` the window wraps midnight (e.g. start=1320 end=480
 * → 22:00..08:00 UTC).
 *
 * Exported so the dispatch tests can assert the math without going
 * through Prisma.
 */
export function msUntilQuietHoursEnd(
  now: Date,
  startUtcMinute: number,
  endUtcMinute: number,
): number {
  const nowMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const wraps = endUtcMinute < startUtcMinute;
  const inWindow = wraps
    ? nowMinute >= startUtcMinute || nowMinute < endUtcMinute
    : nowMinute >= startUtcMinute && nowMinute < endUtcMinute;
  if (!inWindow) return 0;
  // Remaining whole minutes to the window end, accounting for the
  // sub-minute portion of `now`. We add the leftover seconds so the
  // delay matches the wall-clock moment the window ends.
  const minutesToEnd =
    wraps && nowMinute >= startUtcMinute
      ? 1440 - nowMinute + endUtcMinute
      : endUtcMinute - nowMinute;
  const subMinuteMs = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  return minutesToEnd * 60_000 - subMinuteMs;
}
