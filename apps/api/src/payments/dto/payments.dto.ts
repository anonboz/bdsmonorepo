import { recordManualPaymentSchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const RecordManualPaymentDto = createZodDto(recordManualPaymentSchema);
export type RecordManualPaymentDto = typeof recordManualPaymentSchema._type;
