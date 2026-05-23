import { z } from 'zod';

import { isoDateTimeSchema } from './common';

/**
 * Phase 10.6 — self-serve account-deletion request shape returned to
 * the user. Mirrors the columns on `AccountErasureRequest` excluding
 * the `undoToken` (which is delivered out-of-band via email).
 */
export const accountErasureRequestSchema = z.object({
  requestedAt: isoDateTimeSchema,
  /** Wall-clock UTC moment the sweeper will pick this up. */
  executeAfter: isoDateTimeSchema,
  /** Non-null when the user (or the undo link) cancelled. */
  cancelledAt: isoDateTimeSchema.nullable(),
  /** Non-null once the sweeper has finished anonymizing. Terminal. */
  completedAt: isoDateTimeSchema.nullable(),
});
export type AccountErasureRequestResponse = z.infer<typeof accountErasureRequestSchema>;

/**
 * Public POST body for the email-link cancel endpoint. No auth — the
 * token is the credential.
 */
export const eraseCancelInputSchema = z.object({
  token: z.string().min(32).max(128),
});
export type EraseCancelInput = z.infer<typeof eraseCancelInputSchema>;
