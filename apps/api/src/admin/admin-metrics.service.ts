import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import type { MetricsResponse, QueueDepth } from '@repo/shared';

import { env } from '../env.js';
import { isSentryEnabled } from '../observability/sentry.js';
import {
  QUEUE_BILLS_GENERATE,
  QUEUE_BILLS_SWEEP,
  QUEUE_CAMPAIGNS_EXPIRY,
  QUEUE_PAYOUTS_RELEASE,
} from '../queues/queue-names.js';

/**
 * Reads BullMQ job counts for each registered queue and pings Redis
 * via one of the queue's clients. Used by `/v1/admin/metrics` to power
 * uptime dashboards + queue-depth alerts.
 *
 * All queues share the QueuesModule connection so any one client ping
 * is sufficient — we use `billsGenerate` because it's the first in the
 * BullModule register order and always exists.
 */
@Injectable()
export class AdminMetricsService {
  private readonly queues: { name: string; queue: Queue }[];

  constructor(
    @InjectQueue(QUEUE_BILLS_GENERATE) private readonly billsGenerate: Queue,
    @InjectQueue(QUEUE_BILLS_SWEEP) billsSweep: Queue,
    @InjectQueue(QUEUE_CAMPAIGNS_EXPIRY) campaignsExpiry: Queue,
    @InjectQueue(QUEUE_PAYOUTS_RELEASE) payoutsRelease: Queue,
  ) {
    this.queues = [
      { name: QUEUE_BILLS_GENERATE, queue: this.billsGenerate },
      { name: QUEUE_BILLS_SWEEP, queue: billsSweep },
      { name: QUEUE_CAMPAIGNS_EXPIRY, queue: campaignsExpiry },
      { name: QUEUE_PAYOUTS_RELEASE, queue: payoutsRelease },
    ];
  }

  async getMetrics(): Promise<MetricsResponse> {
    const queues = await Promise.all(this.queues.map(({ name, queue }) => this.depth(name, queue)));
    const redis = await this.pingRedis();
    return {
      generatedAt: new Date().toISOString(),
      queues,
      redis,
      sentry: {
        enabled: isSentryEnabled(),
        environment: isSentryEnabled() ? env.NODE_ENV : null,
      },
    };
  }

  private async depth(name: string, queue: Queue): Promise<QueueDepth> {
    try {
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );
      return {
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      };
    } catch {
      // Redis unreachable — surface zeros rather than 500ing the
      // whole endpoint; the redis check below tells the caller why.
      return { name, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    }
  }

  private async pingRedis(): Promise<{ connected: boolean; pingMs: number | null }> {
    try {
      const client = await this.billsGenerate.client;
      const start = Date.now();
      const pong = await client.ping();
      const pingMs = Date.now() - start;
      return { connected: pong === 'PONG', pingMs };
    } catch {
      return { connected: false, pingMs: null };
    }
  }
}
