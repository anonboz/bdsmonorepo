import { Module } from '@nestjs/common';

import { RatingsMeController } from './ratings.me.controller.js';
import { RatingsOwnerController } from './ratings.owner.controller.js';
import { RatingsService } from './ratings.service.js';
import { RatingsTenantController } from './ratings.tenant.controller.js';
import { RatingsUsersController } from './ratings.users.controller.js';

@Module({
  controllers: [
    RatingsTenantController,
    RatingsOwnerController,
    RatingsMeController,
    RatingsUsersController,
  ],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
