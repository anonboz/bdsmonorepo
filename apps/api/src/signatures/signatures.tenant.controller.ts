import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Signature } from '@repo/shared';

import { CreateSignatureDto } from './dto/signatures.dto.js';
import { SignaturesService } from './signatures.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('signatures')
@ApiBearerAuth()
@Controller('me/leases/:leaseId/signatures')
export class SignaturesTenantController {
  constructor(private readonly service: SignaturesService) {}

  @Get()
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leaseId') leaseId: string,
  ): Promise<Signature[]> {
    return this.service.listForTenant(user, leaseId);
  }

  @Post()
  @Roles('TENANT')
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('leaseId') leaseId: string,
    @Body() body: CreateSignatureDto,
  ): Promise<Signature> {
    return this.service.createForTenant(user, leaseId, body, requestContextFrom(user, req));
  }
}
