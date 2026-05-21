import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { CreateMediaUploadResponse, MediaAsset } from '@repo/shared';

import { CreateMediaUploadDto } from './dto/media.dto.js';
import { MediaService } from './media.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Media upload endpoints. Every authenticated role can upload; each
 * asset is scoped to `ownerUserId === actor.id` so cross-user reads
 * 404. The shared decorator listing four roles is just RolesGuard
 * appeasement — there's no role-specific behavior here.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly service: MediaService) {}

  @Post('uploads')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  createUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateMediaUploadDto,
  ): Promise<CreateMediaUploadResponse> {
    return this.service.createUpload(user.id, body);
  }

  @Post('uploads/:id/confirm')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MediaAsset> {
    return this.service.confirmUpload(user.id, id);
  }

  @Get(':id')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<MediaAsset> {
    return this.service.getForUser(user.id, id);
  }
}
