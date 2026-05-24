import { createSignatureInputSchema, type signatureSchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateSignatureDto = createZodDto(createSignatureInputSchema);
export type CreateSignatureDto = typeof createSignatureInputSchema._type;

export type SignatureResponse = typeof signatureSchema._type;
