// Side-effect: load apps/api/.env into process.env before the validator runs.
// Skipped in production where env is set by the runtime (Docker, Vercel, etc.).
import 'dotenv/config';

import { z } from 'zod';

import { databaseUrl, loadEnv, nodeEnv, port, redisUrl, url } from '@repo/config/env';

const envSchema = z.object({
  NODE_ENV: nodeEnv,
  API_PORT: port.default(3001),
  API_PUBLIC_URL: url().default('http://localhost:3001'),
  API_CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:3000,http://localhost:3010,http://localhost:3020,http://localhost:3030',
    )
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),
  AUTH_JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  AUTH_JWT_REFRESH_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  AUTH_COOKIE_DOMAIN: z.string().default('localhost'),

  EMAIL_FROM: z.string().default('BDS <no-reply@localhost>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: port.default(1025),

  SENTRY_DSN: z.string().url().optional(),
  POSTHOG_KEY: z.string().optional(),
});

export const env = loadEnv(envSchema);
export type Env = typeof env;
