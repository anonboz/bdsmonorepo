import { z } from 'zod';

/**
 * cuid2 ids: lowercase alphanumeric, length 24 by default. We accept 16-32 to
 * stay flexible if config changes upstream.
 */
export const idSchema = z
  .string()
  .regex(/^[a-z0-9]{16,32}$/, 'Expected a cuid2-style id (16-32 lowercase alphanumeric)');

export type Id = z.infer<typeof idSchema>;

export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/**
 * Currency stored as ISO-4217 uppercase code.
 */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Expected ISO-4217 currency code');

/**
 * Money: integer in minor units (cents, xu, etc.) + currency.
 * Never use floats for money.
 */
export const moneySchema = z.object({
  amount: z.number().int().describe('Amount in the smallest currency unit (e.g., cents).'),
  currency: currencySchema,
});

export type Money = z.infer<typeof moneySchema>;

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Expected E.164 phone number (e.g., +14155552671)');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.string().email());

export const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().length(2).toUpperCase().describe('ISO 3166-1 alpha-2 country code'),
});

export type Address = z.infer<typeof addressSchema>;

export const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type Geo = z.infer<typeof geoSchema>;

// ---- Pagination -------------------------------------------------------

export const paginationQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative().optional(),
  });
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}
