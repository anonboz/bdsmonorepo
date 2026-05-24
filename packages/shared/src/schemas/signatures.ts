import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';
import { signatureRoleSchema } from '../enums/misc';

/**
 * Phase 12.3 — captured signature for in-platform lease acknowledgement.
 *
 * **Not** legally binding under VN's Electronic Transactions Law 2005 —
 * a registered CA (FPT.eContract / VNPT.eContract) lands in Phase 13.
 * v1 is sufficient for in-platform contract acknowledgement + a dispute
 * trail in `AuditLog`.
 */
export const signatureSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  signerId: idSchema,
  role: signatureRoleSchema,
  /** Base64-encoded PNG data URI; `'data:image/png;base64,...'`. */
  imageDataUri: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  signedAt: isoDateTimeSchema,
});

export type Signature = z.infer<typeof signatureSchema>;

/**
 * App-level cap on the raw `imageDataUri` string (NOT the decoded
 * byte size). 100 KB string = ~75 KB of PNG bytes after base64,
 * comfortable for a hand-drawn signature at 600×200 px.
 *
 * Larger uploads → 413 `signatures.too_large` from the API.
 */
export const SIGNATURE_MAX_DATA_URI_BYTES = 100 * 1024;

const PNG_DATA_URI_PREFIX = 'data:image/png;base64,';

export const createSignatureInputSchema = z.object({
  imageDataUri: z
    .string()
    .min(PNG_DATA_URI_PREFIX.length + 8, 'Signature image is empty')
    .max(SIGNATURE_MAX_DATA_URI_BYTES, 'Signature image is too large')
    .refine(
      (s) => s.startsWith(PNG_DATA_URI_PREFIX),
      'Signature must be a base64-encoded PNG data URI',
    ),
});

export type CreateSignatureInput = z.infer<typeof createSignatureInputSchema>;
