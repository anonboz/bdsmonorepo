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
@Controller('houses/:houseId/units/:unitId/leases/:leaseId/signatures')
export class SignaturesOwnerController {
  constructor(private readonly service: SignaturesService) {}

  @Get()
  @Roles('OWNER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
  ): Promise<Signature[]> {
    return this.service.listForOwner(user, houseId, unitId, leaseId);
  }

  @Post()
  @Roles('OWNER')
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Body() body: CreateSignatureDto,
  ): Promise<Signature> {
    return this.service.createForOwner(
      user,
      houseId,
      unitId,
      leaseId,
      body,
      requestContextFrom(user, req),
    );
  }
}
