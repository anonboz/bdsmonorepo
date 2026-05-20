import { Module } from '@nestjs/common';

import { PartnersPartnerController } from './partners.partner.controller.js';
import { PartnersPublicController } from './partners.public.controller.js';
import { PartnersService } from './partners.service.js';

@Module({
  controllers: [PartnersPartnerController, PartnersPublicController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
