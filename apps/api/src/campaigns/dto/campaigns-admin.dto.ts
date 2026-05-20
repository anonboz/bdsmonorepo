import {
  approveCampaignSchema,
  listAdminCampaignsQuerySchema,
  rejectCampaignSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListAdminCampaignsQueryDto = createZodDto(listAdminCampaignsQuerySchema);
export type ListAdminCampaignsQueryDto = typeof listAdminCampaignsQuerySchema._type;

export const ApproveCampaignDto = createZodDto(approveCampaignSchema);
export type ApproveCampaignDto = typeof approveCampaignSchema._type;

export const RejectCampaignDto = createZodDto(rejectCampaignSchema);
export type RejectCampaignDto = typeof rejectCampaignSchema._type;
