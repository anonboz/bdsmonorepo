import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP, magicLink } from 'better-auth/plugins';

import { prisma } from '@repo/db';

import { env } from '../env.js';

/**
 * Better-Auth instance. Mounted under `/v1/auth/*` by AuthController.
 *
 * Field mapping: we use `displayName` and `avatarUrl` / `image` in our schema;
 * better-auth maps its `name` and `image` to those columns. Roles, KYC and
 * suspension state are *not* additionalFields here — they're read separately
 * by AuthGuard after session validation. This keeps better-auth focused on
 * sessions and lets our domain own authorization.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.AUTH_SECRET,
  baseURL: env.API_PUBLIC_URL,
  basePath: '/v1/auth',
  trustedOrigins: env.API_CORS_ORIGINS,

  session: {
    expiresIn: env.AUTH_JWT_REFRESH_TTL,
    updateAge: 60 * 60 * 24, // refresh sliding window once per day
    cookieCache: {
      enabled: true,
      maxAge: env.AUTH_JWT_ACCESS_TTL,
    },
  },

  user: {
    fields: {
      // map better-auth's `name` field to our column
      name: 'displayName',
    },
  },

  advanced: {
    cookiePrefix: 'bds',
    useSecureCookies: env.NODE_ENV === 'production',
    crossSubDomainCookies: {
      enabled: env.NODE_ENV === 'production',
      domain: env.AUTH_COOKIE_DOMAIN,
    },
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 10, // 10 min
      async sendVerificationOTP({ email, otp, type }) {
        // TODO Phase 2: wire to Resend / SMTP.
        // eslint-disable-next-line no-console
        console.log(`[auth] OTP (${type}) for ${email}: ${otp}`);
      },
    }),
    magicLink({
      expiresIn: 60 * 10,
      async sendMagicLink({ email, url }) {
        // TODO Phase 2: wire to Resend / SMTP.
        // eslint-disable-next-line no-console
        console.log(`[auth] Magic link for ${email}: ${url}`);
      },
    }),
  ],
});

export type Auth = typeof auth;
