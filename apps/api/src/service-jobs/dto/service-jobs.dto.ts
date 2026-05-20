import {
  cancelServiceJobSchema,
  completeServiceJobSchema,
  createServiceJobSchema,
  listServiceJobsQuerySchema,
  quoteServiceJobSchema,
  type serviceJobSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateServiceJobDto = createZodDto(createServiceJobSchema);
export type CreateServiceJobDto = typeof createServiceJobSchema._type;

export const QuoteServiceJobDto = createZodDto(quoteServiceJobSchema);
export type QuoteServiceJobDto = typeof quoteServiceJobSchema._type;

export const CompleteServiceJobDto = createZodDto(completeServiceJobSchema);
export type CompleteServiceJobDto = typeof completeServiceJobSchema._type;

export const CancelServiceJobDto = createZodDto(cancelServiceJobSchema);
export type CancelServiceJobDto = typeof cancelServiceJobSchema._type;

export const ListServiceJobsQueryDto = createZodDto(listServiceJobsQuerySchema);
export type ListServiceJobsQueryDto = typeof listServiceJobsQuerySchema._type;

export type ServiceJobResponse = typeof serviceJobSchema._type;
