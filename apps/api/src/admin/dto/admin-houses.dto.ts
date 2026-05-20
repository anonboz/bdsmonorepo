import {
  clearHouseModerationSchema,
  flagHouseSchema,
  listAdminHousesQuerySchema,
  rejectHouseSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListAdminHousesQueryDto = createZodDto(listAdminHousesQuerySchema);
export type ListAdminHousesQueryDto = typeof listAdminHousesQuerySchema._type;

export const FlagHouseDto = createZodDto(flagHouseSchema);
export type FlagHouseDto = typeof flagHouseSchema._type;

export const ClearHouseModerationDto = createZodDto(clearHouseModerationSchema);
export type ClearHouseModerationDto = typeof clearHouseModerationSchema._type;

export const RejectHouseDto = createZodDto(rejectHouseSchema);
export type RejectHouseDto = typeof rejectHouseSchema._type;
