import {
  type applicationSchema,
  createApplicationSchema,
  listApplicationsQuerySchema,
  rejectApplicationSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateApplicationDto = createZodDto(createApplicationSchema);
export type CreateApplicationDto = typeof createApplicationSchema._type;

export const RejectApplicationDto = createZodDto(rejectApplicationSchema);
export type RejectApplicationDto = typeof rejectApplicationSchema._type;

export const ListApplicationsQueryDto = createZodDto(listApplicationsQuerySchema);
export type ListApplicationsQueryDto = typeof listApplicationsQuerySchema._type;

export type ApplicationResponse = typeof applicationSchema._type;
