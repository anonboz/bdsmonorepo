import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  LOCALE_COOKIE,
  type MeResponse,
  meUpdateInputSchema,
  setPasswordSchema,
} from '@repo/shared';

import type { AuthenticatedUser } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { AuthGuard } from './guards/auth.guard.js';
import { PasswordService } from './password.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { createZodDto } from '../common/dto/zod-dto.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { env } from '../env.js';

export const MeUpdateDto = createZodDto(meUpdateInputSchema);
export type MeUpdateDto = typeof meUpdateInputSchema._type;

export const SetPasswordDto = createZodDto(setPasswordSchema);
export type SetPasswordDto = typeof setPasswordSchema._type;

const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

@ApiTags('auth')
@ApiBearerAuth()
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
    private readonly password: PasswordService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const hasPassword = await this.password.hasPassword(user.id);
    return this.buildMeResponse(user, user.locale, hasPassword);
  }

  /**
   * Phase 12.6 — set a login password for the session user (OTP-first
   * users opting into phone + password login). Delegates to better-auth,
   * which creates the credential account; we forward the request headers
   * so it resolves the same session AuthGuard validated. Audited.
   */
  @Post('set-password')
  @HttpCode(204)
  async setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: SetPasswordDto,
    @Req() req: FastifyRequest,
  ): Promise<void> {
    await this.password.setPassword(toWebHeaders(req), body.newPassword);
    await this.audit.writeOnce({
      actorId: user.id,
      action: 'auth.password.set',
      target: `User:${user.id}`,
      meta: {},
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
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

    const hasPassword = await this.password.hasPassword(user.id);
    return this.buildMeResponse(user, updatedLocale, hasPassword);
  }

  private buildMeResponse(
    user: AuthenticatedUser,
    locale: AuthenticatedUser['locale'],
    hasPassword: boolean,
  ): MeResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        roles: user.roles,
        isSuspended: user.isSuspended,
        locale,
      },
      // Session expiry is enforced by better-auth's cookie; this echoes a
      // reasonable client hint. The cookie is the source of truth.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      hasPassword,
    };
  }
}

/** Convert Fastify's incoming headers into a Web `Headers` for better-auth. */
function toWebHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.append(key, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return headers;
}
