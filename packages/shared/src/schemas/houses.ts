import { z } from 'zod';

import {
  addressSchema,
  geoSchema,
  idSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
} from './common';
import { houseModerationStatusSchema } from '../enums/misc';

export const houseSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  address: addressSchema,
  geo: geoSchema.nullable(),
  unitCount: z.number().int().nonnegative(),
  isPublished: z.boolean(),
  moderationStatus: houseModerationStatusSchema,
  moderationReason: z.string().max(500).nullable(),
  moderationDecidedAt: isoDateTimeSchema.nullable(),
  moderationDecidedBy: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type House = z.infer<typeof houseSchema>;

export const createHouseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  address: addressSchema,
  geo: geoSchema.optional(),
  isPublished: z.boolean().default(false),
});

export type CreateHouseInput = z.infer<typeof createHouseSchema>;

export const updateHouseSchema = createHouseSchema.partial();
export type UpdateHouseInput = z.infer<typeof updateHouseSchema>;

export const listHousesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  isPublished: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListHousesQuery = z.infer<typeof listHousesQuerySchema>;
