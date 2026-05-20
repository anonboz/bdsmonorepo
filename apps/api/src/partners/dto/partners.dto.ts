import {
  createServiceSchema,
  listPartnersQuerySchema,
  type partnerProfileSchema,
  type serviceSchema,
  updateServiceSchema,
  upsertPartnerProfileSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const UpsertPartnerProfileDto = createZodDto(upsertPartnerProfileSchema);
export type UpsertPartnerProfileDto = typeof upsertPartnerProfileSchema._type;

export const CreateServiceDto = createZodDto(createServiceSchema);
export type CreateServiceDto = typeof createServiceSchema._type;

export const UpdateServiceDto = createZodDto(updateServiceSchema);
export type UpdateServiceDto = typeof updateServiceSchema._type;

export const ListPartnersQueryDto = createZodDto(listPartnersQuerySchema);
export type ListPartnersQueryDto = typeof listPartnersQuerySchema._type;

export type PartnerProfileResponse = typeof partnerProfileSchema._type;
export type ServiceResponse = typeof serviceSchema._type;
