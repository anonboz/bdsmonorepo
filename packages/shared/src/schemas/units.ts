import { z } from 'zod';

import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { unitStatusSchema } from '../enums/misc';

export const unitSchema = z.object({
  id: idSchema,
  houseId: idSchema,
  label: z.string().min(1).max(60),
  status: unitStatusSchema,
  floor: z.number().int().nullable(),
  sqm: z.number().int().positive().nullable(),
  bedrooms: z.number().int().nonnegative().nullable(),
  bathrooms: z.number().int().nonnegative().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type Unit = z.infer<typeof unitSchema>;

export const createUnitSchema = z.object({
  label: z.string().min(1).max(60),
  status: unitStatusSchema.default('VACANT'),
  floor: z.number().int().optional(),
  sqm: z.number().int().positive().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = createUnitSchema.partial();
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const listUnitsQuerySchema = paginationQuerySchema.extend({
  status: unitStatusSchema.optional(),
});

export type ListUnitsQuery = z.infer<typeof listUnitsQuerySchema>;
