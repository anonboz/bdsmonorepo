import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { House, Page } from '@repo/shared';

import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  CreateHouseDto,
  ListHousesQueryDto,
  UpdateHouseDto,
} from './dto/houses.dto.js';
import { HousesService } from './houses.service.js';

/**
 * REFERENCE MODULE. Copy this layout when adding new domain modules:
 *   - DTOs are Zod schemas wrapped via createZodDto in `dto/`
 *   - Controller is thin — translates HTTP ↔ service calls
 *   - Service holds business rules + authorization logic
 *   - `@Roles(...)` gates by role; per-resource ownership lives in the service
 *
 * Pagination is cursor-based (`?cursor=<id>&limit=20&sort=desc`). The response
 * shape is `{ items, nextCursor, total? }` — see `pageSchema` in @repo/shared.
 */
@ApiTags('houses')
@ApiBearerAuth()
@Controller('houses')
export class HousesController {
  constructor(private readonly service: HousesService) {}

  @Post()
  @Roles('OWNER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateHouseDto,
  ): Promise<House> {
    return this.service.create(user.id, body);
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListHousesQueryDto,
  ): Promise<Page<House>> {
    return this.service.list(user, query);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<House> {
    return this.service.getById(user, id);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: UpdateHouseDto,
  ): Promise<House> {
    return this.service.update(user, id, body);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.softDelete(user, id);
  }
}
