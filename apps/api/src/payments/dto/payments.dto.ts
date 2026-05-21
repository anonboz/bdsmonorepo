import { recordManualPaymentSchema, refundPaymentSchema } from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const RecordManualPaymentDto = createZodDto(recordManualPaymentSchema);
export type RecordManualPaymentDto = typeof recordManualPaymentSchema._type;

export const RefundPaymentDto = createZodDto(refundPaymentSchema);
export type RefundPaymentDto = typeof refundPaymentSchema._type;
