import { listPublicCampaignsQuerySchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListPublicCampaignsQueryDto = createZodDto(listPublicCampaignsQuerySchema);
export type ListPublicCampaignsQueryDto = typeof listPublicCampaignsQuerySchema._type;
