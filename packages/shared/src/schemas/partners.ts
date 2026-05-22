import { z } from 'zod';

import {
  currencySchema,
  emailSchema,
  idSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
} from './common';
import { kycStatusSchema } from '../enums/misc';

/**
 * Snapshot of Stripe Express onboarding state. The webhook keeps
 * this fresh; admin disbursement gates STRIPE_CONNECT on `ACTIVE`.
 */
export const StripeConnectStatus = {
  NOT_STARTED: 'NOT_STARTED',
  ONBOARDING: 'ONBOARDING',
  ACTIVE: 'ACTIVE',
  RESTRICTED: 'RESTRICTED',
} as const;
export type StripeConnectStatus = (typeof StripeConnectStatus)[keyof typeof StripeConnectStatus];
export const stripeConnectStatusSchema = z.nativeEnum(StripeConnectStatus);

export const partnerProfileSchema = z.object({
  id: idSchema,
  userId: idSchema,
  /** Joined from the User row on read. */
  displayName: z.string(),
  email: emailSchema.nullable(),
  businessName: z.string().min(1).max(200),
  bio: z.string().max(2000).nullable(),
  serviceArea: z.string().max(500).nullable(),
  kycStatus: kycStatusSchema,
  stripeConnectStatus: stripeConnectStatusSchema,
  stripeConnectOnboardedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type PartnerProfile = z.infer<typeof partnerProfileSchema>;

export const startStripeOnboardingResponseSchema = z.object({
  /** Stripe-hosted onboarding URL. Short-lived (~5 minutes). */
  url: z.string().url(),
  expiresAt: isoDateTimeSchema,
});
export type StartStripeOnboardingResponse = z.infer<typeof startStripeOnboardingResponseSchema>;

export const upsertPartnerProfileSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(2000).optional(),
  serviceArea: z.string().trim().max(500).optional(),
});

export type UpsertPartnerProfileInput = z.infer<typeof upsertPartnerProfileSchema>;

export const serviceSchema = z.object({
  id: idSchema,
  partnerId: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  /** Minor units. */
  basePrice: z.number().int().nonnegative(),
  currency: currencySchema,
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type Service = z.infer<typeof serviceSchema>;

export const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  basePrice: z.number().int().nonnegative(),
  currency: currencySchema,
  isActive: z.boolean().default(true),
});

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = createServiceSchema.partial();
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const listPartnersQuerySchema = paginationQuerySchema.extend({
  /** Substring match against businessName and serviceArea. */
  q: z.string().trim().max(100).optional(),
});

export type ListPartnersQuery = z.infer<typeof listPartnersQuerySchema>;

/**
 * Owner-side projection. Inlines the partner's active services so the
 * list view can render cards without an extra round trip. `ratingAverage`
 * is `null` when the partner has zero ratings; the directory sort treats
 * that as last so a rated partner always outranks an unrated one.
 */
export const partnerSummarySchema = partnerProfileSchema.extend({
  activeServices: z.array(serviceSchema),
  ratingAverage: z.number().nullable(),
  ratingCount: z.number().int().nonnegative(),
});

export type PartnerSummary = z.infer<typeof partnerSummarySchema>;
