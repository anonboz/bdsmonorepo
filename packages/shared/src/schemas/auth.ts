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

/**
 * Phase 12.6 — phone + password sign-in, added alongside the OTP flows.
 * Length bounds are mirrored in better-auth's `emailAndPassword`
 * (`minPasswordLength` / `maxPasswordLength`) so client and server agree.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

/** Body the client posts to better-auth's `/v1/auth/sign-in/phone-number`. */
export const phonePasswordSignInSchema = z.object({
  phoneNumber: phoneSchema,
  password: passwordSchema,
  rememberMe: z.boolean().optional(),
});

export type PhonePasswordSignIn = z.infer<typeof phonePasswordSignInSchema>;

/** Body for `POST /v1/me/set-password` — sets a password for the session user. */
export const setPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

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
  /**
   * Phase 12.6 — whether the user has set a login password. Clients use
   * this to nudge the "set a password" screen after an OTP login.
   */
  hasPassword: z.boolean(),
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
