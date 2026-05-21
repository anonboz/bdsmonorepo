import { createMediaUploadSchema, type mediaAssetSchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateMediaUploadDto = createZodDto(createMediaUploadSchema);
export type CreateMediaUploadDto = typeof createMediaUploadSchema._type;

export type MediaAssetResponse = typeof mediaAssetSchema._type;
