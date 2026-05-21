import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Queue } from 'bullmq';

import { Public } from '../auth/decorators/public.decorator.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { QUEUE_BILLS_GENERATE } from '../queues/queue-names.js';

@ApiTags('health')
@Public()
@Controller()
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    @InjectQueue(QUEUE_BILLS_GENERATE) private readonly probe: Queue,
  ) {}

  @Get('healthz')
  liveness() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('readyz')
  async readiness() {
    const checks: Record<string, 'ok' | 'fail'> = { db: 'fail', redis: 'fail' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch {
      checks.db = 'fail';
    }
    try {
      const client = await this.probe.client;
      const pong = await client.ping();
      checks.redis = pong === 'PONG' ? 'ok' : 'fail';
    } catch {
      checks.redis = 'fail';
    }
    const ok = Object.values(checks).every((c) => c === 'ok');
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
