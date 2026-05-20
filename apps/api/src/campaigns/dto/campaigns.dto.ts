import {
  type campaignSchema,
  createCampaignSchema,
  listCampaignsQuerySchema,
  transitionCampaignSchema,
  updateCampaignSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateCampaignDto = createZodDto(createCampaignSchema);
export type CreateCampaignDto = typeof createCampaignSchema._type;

export const UpdateCampaignDto = createZodDto(updateCampaignSchema);
export type UpdateCampaignDto = typeof updateCampaignSchema._type;

export const TransitionCampaignDto = createZodDto(transitionCampaignSchema);
export type TransitionCampaignDto = typeof transitionCampaignSchema._type;

export const ListCampaignsQueryDto = createZodDto(listCampaignsQuerySchema);
export type ListCampaignsQueryDto = typeof listCampaignsQuerySchema._type;

export type CampaignResponse = typeof campaignSchema._type;
