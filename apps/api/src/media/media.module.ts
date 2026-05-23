import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { SharpImageProcessor } from './image-processor.sharp.js';
import { MediaController } from './media.controller.js';
import { MediaProcessWorker } from './media.processor.js';
import { IMAGE_PROCESSOR, MediaService } from './media.service.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { env } from '../env.js';
import { QUEUE_MEDIA_PROCESS } from '../queues/queue-names.js';

@Module({
  imports: [AuditModule, BullModule.registerQueue({ name: QUEUE_MEDIA_PROCESS })],
  controllers: [MediaController],
  providers: [
    MediaService,
    { provide: IMAGE_PROCESSOR, useClass: SharpImageProcessor },
    ...(env.API_DISABLE_QUEUES ? [] : [MediaProcessWorker]),
  ],
})
export class MediaModule {}
