import { Body, Controller, Get, HttpCode, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { updatePlatformConfigSchema, type PlatformConfig } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { createZodDto } from '../common/dto/zod-dto.js';
import { PlatformConfigService } from '../platform/platform-config.service.js';

class UpdatePlatformConfigDto extends createZodDto(updatePlatformConfigSchema) {}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/platform-config')
export class AdminPlatformController {
  constructor(private readonly service: PlatformConfigService) {}

  @Get()
  @Roles('ADMIN')
  get(): Promise<PlatformConfig> {
    return this.service.get();
  }

  @Put()
  @Roles('ADMIN')
  @HttpCode(200)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Body() body: UpdatePlatformConfigDto,
  ): Promise<PlatformConfig> {
    return this.service.update(body, {
      actorId: user.id,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }
}
