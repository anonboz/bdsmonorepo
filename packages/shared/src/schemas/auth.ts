import { z } from 'zod';

import { emailSchema, idSchema, phoneSchema } from './common';
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
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const meResponseSchema = z.object({
  user: sessionUserSchema,
  expiresAt: z.string().datetime({ offset: true }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
