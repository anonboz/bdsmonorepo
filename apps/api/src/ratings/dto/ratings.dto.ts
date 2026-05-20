import {
  createLeaseRatingSchema,
  type leaseRatingSchema,
  type leaseRatingStateSchema,
  listLeaseRatingsQuerySchema,
  type userRatingSummarySchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateLeaseRatingDto = createZodDto(createLeaseRatingSchema);
export type CreateLeaseRatingDto = typeof createLeaseRatingSchema._type;

export const ListLeaseRatingsQueryDto = createZodDto(listLeaseRatingsQuerySchema);
export type ListLeaseRatingsQueryDto = typeof listLeaseRatingsQuerySchema._type;

export type LeaseRatingResponse = typeof leaseRatingSchema._type;
export type LeaseRatingStateResponse = typeof leaseRatingStateSchema._type;
export type UserRatingSummaryResponse = typeof userRatingSummarySchema._type;
