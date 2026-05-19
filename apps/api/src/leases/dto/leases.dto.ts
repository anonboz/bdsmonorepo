import {
  createLeaseSchema,
  type leaseSchema,
  listLeasesQuerySchema,
  transitionLeaseSchema,
  updateLeaseSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateLeaseDto = createZodDto(createLeaseSchema);
export type CreateLeaseDto = typeof createLeaseSchema._type;

export const UpdateLeaseDto = createZodDto(updateLeaseSchema);
export type UpdateLeaseDto = typeof updateLeaseSchema._type;

export const TransitionLeaseDto = createZodDto(transitionLeaseSchema);
export type TransitionLeaseDto = typeof transitionLeaseSchema._type;

export const ListLeasesQueryDto = createZodDto(listLeasesQuerySchema);
export type ListLeasesQueryDto = typeof listLeasesQuerySchema._type;

export type LeaseResponse = typeof leaseSchema._type;
