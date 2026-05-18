import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '../auth/decorators/public.decorator.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

@ApiTags('health')
@Public()
@Controller()
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  @Get('healthz')
  liveness() {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('readyz')
  async readiness() {
    const checks: Record<string, 'ok' | 'fail'> = { db: 'fail' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'ok';
    } catch {
      checks.db = 'fail';
    }
    const ok = Object.values(checks).every((c) => c === 'ok');
    return { status: ok ? 'ok' : 'degraded', checks };
  }
}
