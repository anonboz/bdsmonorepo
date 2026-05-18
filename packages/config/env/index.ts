import { z, type ZodType, type ZodObject, type ZodRawShape, type infer as ZodInfer } from 'zod';

/**
 * Strict env loader. Validates `source` against `schema` and throws a single
 * aggregated error if anything is missing or malformed. Always returns a
 * frozen object so callers can't mutate process-wide config.
 */
export function loadEnv<Shape extends ZodRawShape>(
  schema: ZodObject<Shape>,
  source: Record<string, string | undefined> = process.env,
): Readonly<ZodInfer<ZodObject<Shape>>> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return Object.freeze(result.data);
}

export const stringBool = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

export const port = z.coerce.number().int().min(1).max(65535);

export const nodeEnv = z.enum(['development', 'test', 'production']).default('development');

export const url = (opts: { protocols?: readonly string[] } = {}) =>
  z
    .string()
    .url()
    .refine(
      (v) => !opts.protocols || opts.protocols.some((p) => v.startsWith(`${p}:`)),
      `URL must use one of: ${(opts.protocols ?? []).join(', ')}`,
    );

export const databaseUrl = url({ protocols: ['postgres', 'postgresql'] });
export const redisUrl = url({ protocols: ['redis', 'rediss'] });

export type EnvOf<S extends ZodType> = ZodInfer<S>;
