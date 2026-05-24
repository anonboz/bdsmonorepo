import { z } from 'zod';

import {
  currencySchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
} from './common';
import { leaseStatusSchema, rentCycleSchema } from '../enums/misc';

export const leaseSchema = z.object({
  id: idSchema,
  unitId: idSchema,
  /** Denormalized for filtering and UI breadcrumbs. */
  houseId: idSchema,
  ownerId: idSchema,
  tenantId: idSchema,
  status: leaseStatusSchema,
  rentCycle: rentCycleSchema,
  /** Minor units. Never use floats. */
  rentAmount: z.number().int().nonnegative(),
  depositAmount: z.number().int().nonnegative(),
  currency: currencySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  terminationReason: z.string().max(500).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type Lease = z.infer<typeof leaseSchema>;

export const createLeaseSchema = z.object({
  tenantId: idSchema,
  rentCycle: rentCycleSchema.default('MONTHLY'),
  rentAmount: z.number().int().nonnegative(),
  depositAmount: z.number().int().nonnegative(),
  currency: currencySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
});

export type CreateLeaseInput = z.infer<typeof createLeaseSchema>;

/**
 * DRAFT-only edits. The service rejects PATCH on non-DRAFT leases — changing
 * rent or term on an active lease should be an explicit amendment workflow
 * (not in this slice).
 */
export const updateLeaseSchema = z.object({
  rentAmount: z.number().int().nonnegative().optional(),
  depositAmount: z.number().int().nonnegative().optional(),
  rentCycle: rentCycleSchema.optional(),
  endDate: isoDateSchema.nullable().optional(),
  tenantId: idSchema.optional(),
});

export type UpdateLeaseInput = z.infer<typeof updateLeaseSchema>;

/**
 * Phase 12.3 — `to: 'ACTIVE'` was removed; owners now move
 * `DRAFT → AWAITING_SIGNATURES` and the signatures service flips the
 * lease to ACTIVE when both Signature rows land. `AWAITING_SIGNATURES →
 * DRAFT` is allowed for re-editing (drops captured signatures).
 */
export const transitionLeaseSchema = z
  .object({
    to: z.enum(['AWAITING_SIGNATURES', 'DRAFT', 'ENDED', 'TERMINATED']),
    terminationReason: z.string().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.to === 'TERMINATED' && !val.terminationReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminationReason'],
        message: 'Required when terminating a lease',
      });
    }
  });

export type TransitionLeaseInput = z.infer<typeof transitionLeaseSchema>;

export const listLeasesQuerySchema = paginationQuerySchema.extend({
  status: leaseStatusSchema.optional(),
});

export type ListLeasesQuery = z.infer<typeof listLeasesQuerySchema>;
