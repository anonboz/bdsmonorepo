import { z } from 'zod';

export const BillStatus = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  VOID: 'VOID',
} as const;

export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus];

export const billStatusSchema = z.nativeEnum(BillStatus);
