import { z } from 'zod';

import { emailSchema, idSchema, phoneSchema } from './common';
import { localeSchema } from '../enums/locale';
import { roleSchema } from '../enums/role';

export const requestOtpSchema = z.object({
  identifier: z.union([emailSchema, phoneSchema]),
});

export const verifyOtpSchema = z.object({
  identifier: z.union([emailSchema, phoneSchema]),
  code: z.string().regex(/^\d{6}$/, 'Expected a 6-digit code'),
});

export const requestMagicLinkSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().url().optional(),
});

export const sessionUserSchema = z.object({
  id: idSchema,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  roles: z.array(roleSchema).min(1),
  displayName: z.string().min(1).max(120),
  isSuspended: z.boolean(),
  /** Phase 11.2 — preferred UI language. */
  locale: localeSchema,
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.string().datetime({ offset: true }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

/**
 * Phase 11.2 — `PATCH /v1/me` input. Locale-only in this slice; future
 * profile fields (displayName, image) get added here when they grow a
 * self-serve flow.
 */
export const meUpdateInputSchema = z
  .object({
    locale: localeSchema.optional(),
  })
  .refine((v) => v.locale !== undefined, {
    message: 'At least one field must be provided.',
  });

export type MeUpdateInput = z.infer<typeof meUpdateInputSchema>;
