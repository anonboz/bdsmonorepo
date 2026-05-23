import { Body, Controller, Delete, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { type AccountErasureRequestResponse, eraseCancelInputSchema } from '@repo/shared';

import { AccountErasureService } from './account-erasure.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { createZodDto } from '../common/dto/zod-dto.js';

export const EraseCancelDto = createZodDto(eraseCancelInputSchema);
export type EraseCancelDto = typeof eraseCancelInputSchema._type;

/**
 * Phase 10.6 — self-serve account-deletion endpoints.
 *
 * `me/erase-request` is the authenticated surface: any role can read,
 * schedule, or cancel their own request. `account/erase-cancel` is
 * an unauthenticated escape hatch — the token in the confirmation
 * email is the credential.
 */
@ApiTags('account')
@Controller()
export class AccountErasureController {
  constructor(private readonly service: AccountErasureService) {}

  // ---- Authenticated self-serve --------------------------------------

  @Get('me/erase-request')
  @ApiBearerAuth()
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  async getMyRequest(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountErasureRequestResponse | null> {
    return this.service.getForUser(user.id);
  }

  @Post('me/erase-request')
  @ApiBearerAuth()
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(200)
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
  ): Promise<AccountErasureRequestResponse> {
    return this.service.request(user.id, contextFrom(user, req));
  }

  @Delete('me/erase-request')
  @ApiBearerAuth()
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(204)
  async cancel(@CurrentUser() user: AuthenticatedUser, @Req() req: FastifyRequest): Promise<void> {
    await this.service.cancel(user.id, contextFrom(user, req));
  }

  // ---- Public undo path ----------------------------------------------

  @Post('account/erase-cancel')
  @Public()
  @HttpCode(200)
  async cancelByToken(@Body() body: EraseCancelDto): Promise<{ ok: true }> {
    await this.service.cancelByToken(body.token);
    return { ok: true };
  }
}

function contextFrom(user: AuthenticatedUser, req: FastifyRequest): RequestContext {
  return {
    actorId: user.id,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
