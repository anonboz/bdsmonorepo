import { z } from 'zod';

/**
 * RFC 7807 problem details. Returned with `application/problem+json` for any
 * error response from the API. `type` is one of `ErrorCode`.
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  /** Set on 422 validation errors — field-keyed messages. */
  errors: z.record(z.string(), z.array(z.string())).optional(),
  /** Set on rate limits. */
  retryAfter: z.number().int().nonnegative().optional(),
  /** Server-generated correlation id for log lookup. */
  traceId: z.string().optional(),
});

export type Problem = z.infer<typeof problemSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
