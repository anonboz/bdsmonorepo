import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, PartnerProfile, Service } from '@repo/shared';

import { CreateServiceDto, UpdateServiceDto, UpsertPartnerProfileDto } from './dto/partners.dto.js';
import { PartnersService } from './partners.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('partners')
@ApiBearerAuth()
@Controller('me')
export class PartnersPartnerController {
  constructor(private readonly service: PartnersService) {}

  // ---- Profile ------------------------------------------------------

  @Get('partner-profile')
  @Roles('PARTNER')
  getProfile(@CurrentUser() user: AuthenticatedUser): Promise<PartnerProfile> {
    return this.service.getOwnProfile(user.id);
  }

  @Put('partner-profile')
  @Roles('PARTNER')
  @HttpCode(200)
  putProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpsertPartnerProfileDto,
  ): Promise<PartnerProfile> {
    return this.service.upsertOwnProfile(user.id, body);
  }

  // ---- Services -----------------------------------------------------

  @Get('services')
  @Roles('PARTNER')
  listServices(@CurrentUser() user: AuthenticatedUser): Promise<Page<Service>> {
    return this.service.listOwnServices(user.id);
  }

  @Post('services')
  @Roles('PARTNER')
  createService(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateServiceDto,
  ): Promise<Service> {
    return this.service.createOwnService(user.id, body);
  }

  @Get('services/:id')
  @Roles('PARTNER')
  getService(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Service> {
    return this.service.getOwnService(user.id, id);
  }

  @Patch('services/:id')
  @Roles('PARTNER')
  updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateServiceDto,
  ): Promise<Service> {
    return this.service.updateOwnService(user.id, id, body);
  }

  @Delete('services/:id')
  @Roles('PARTNER')
  @HttpCode(204)
  async deleteService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.deleteOwnService(user.id, id);
  }
}
