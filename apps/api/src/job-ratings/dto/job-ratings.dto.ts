import { createJobRatingSchema, type jobRatingSchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateJobRatingDto = createZodDto(createJobRatingSchema);
export type CreateJobRatingDto = typeof createJobRatingSchema._type;

export type JobRatingResponse = typeof jobRatingSchema._type;
