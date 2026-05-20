import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP, magicLink } from 'better-auth/plugins';
import { Prisma } from '@prisma/client';

import { prisma } from '@repo/db';

import { env } from '../env.js';

/**
 * Best-effort audit write. Better-Auth runs us from outside Nest's DI
 * graph so we call Prisma directly. Failures are logged but do NOT
 * propagate — an audit hiccup must not block sign-in / sign-out.
 */
async function writeAuthAudit(entry: {
  actorId: string | null;
  action: 'auth.login' | 'auth.logout';
  target: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target,
        meta: entry.meta as Prisma.InputJsonValue,
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[auth] failed to write audit row', err);
  }
}

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

  /**
   * Phase 3.5: emit auth.login / auth.logout into AuditLog whenever a
   * session is created or explicitly deleted. Session lazy-expiry does
   * NOT trigger delete in better-auth, so this maps cleanly to "user
   * pressed sign-in / sign-out".
   */
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          await writeAuthAudit({
            actorId: session.userId,
            action: 'auth.login',
            target: `User:${session.userId}`,
            meta: { sessionId: session.id },
            ip: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
      delete: {
        after: async (session) => {
          await writeAuthAudit({
            actorId: session.userId,
            action: 'auth.logout',
            target: `User:${session.userId}`,
            meta: { sessionId: session.id },
            ip: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
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
