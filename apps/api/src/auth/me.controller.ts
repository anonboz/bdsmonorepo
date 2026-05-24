import { Body, Controller, Get, Inject, Patch, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { LOCALE_COOKIE, type MeResponse, meUpdateInputSchema } from '@repo/shared';

import type { AuthenticatedUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { AuthGuard } from './guards/auth.guard.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { createZodDto } from '../common/dto/zod-dto.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { env } from '../env.js';

export const MeUpdateDto = createZodDto(meUpdateInputSchema);
export type MeUpdateDto = typeof meUpdateInputSchema._type;

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

@ApiTags('auth')
@ApiBearerAuth()
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthenticatedUser): MeResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        roles: user.roles,
        isSuspended: user.isSuspended,
        locale: user.locale,
      },
      // Session expiry is enforced by better-auth's cookie; this echoes a
      // reasonable client hint. The cookie is the source of truth.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  /**
   * Phase 11.2 — self-serve profile patch. Only `locale` is editable
   * in v1; future fields land here as the schema grows.
   *
   * On a locale change we also stamp the {@link LOCALE_COOKIE} cookie
   * on the response so server components on the next request render
   * against the same value the DB row carries. Without the cookie set,
   * the user's next page load would still read whatever the previous
   * cookie said until they manually toggled the switcher again.
   */
  @Patch()
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: MeUpdateDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<MeResponse> {
    const nextLocale = body.locale;
    let updatedLocale = user.locale;

    if (nextLocale && nextLocale !== user.locale) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { locale: nextLocale } });
        await this.audit.write(tx, {
          actorId: user.id,
          action: 'user.locale.update',
          target: `User:${user.id}`,
          meta: { from: user.locale, to: nextLocale },
          ip: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        });
      });
      updatedLocale = nextLocale;
    }

    if (nextLocale) {
      reply.setCookie(LOCALE_COOKIE, nextLocale, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
        sameSite: 'lax',
        secure: env.NODE_ENV === 'production',
      });
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        roles: user.roles,
        isSuspended: user.isSuspended,
        locale: updatedLocale,
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
}
