import { type jobLedgerEntrySchema, listLedgerEntriesQuerySchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListLedgerEntriesQueryDto = createZodDto(listLedgerEntriesQuerySchema);
export type ListLedgerEntriesQueryDto = typeof listLedgerEntriesQuerySchema._type;

export type JobLedgerEntryResponse = typeof jobLedgerEntrySchema._type;
