import { type billSchema, generateBillSchema, listBillsQuerySchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const GenerateBillDto = createZodDto(generateBillSchema);
export type GenerateBillDto = typeof generateBillSchema._type;

export const ListBillsQueryDto = createZodDto(listBillsQuerySchema);
export type ListBillsQueryDto = typeof listBillsQuerySchema._type;

export type BillResponse = typeof billSchema._type;
