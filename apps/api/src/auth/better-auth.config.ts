import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { emailOTP, magicLink } from 'better-auth/plugins';
import { Prisma } from '@prisma/client';

import { prisma } from '@repo/db';

import { getPostHog } from '../common/analytics/analytics.client.js';
import { getMailer } from '../common/mailer/mailer.client.js';
import { renderMagicLinkTemplate, renderOtpTemplate } from '../common/mailer/templates.js';
import { env } from '../env.js';
import { getCookieLocale } from './locale-context.js';

/**
 * Best-effort audit write. Better-Auth runs us from outside Nest's DI
 * graph so we call Prisma directly. Failures are logged but do NOT
 * propagate — an audit hiccup must not block sign-in / sign-out.
 */
async function writeAuthAudit(entry: {
  actorId: string | null;
  action: 'auth.login' | 'auth.logout' | 'user.signup';
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
    /**
     * Phase 9.5 — signup funnel inlet. Fires once per new User row,
     * writes a `user.signup` audit row + a `user.signed_up` PostHog
     * capture. Both are best-effort; either failing must not block
     * the signup flow.
     *
     * `via` is hardcoded to `'email'` in v1 because both our auth
     * plugins (emailOTP, magicLink) are email-based; the hook's
     * `user` arg doesn't include the originating plugin. Refine to
     * `email_otp` / `magic_link` / `oauth` / etc. when a non-email
     * path lands.
     */
    user: {
      create: {
        after: async (user) => {
          // Phase 11.2 — if the visitor carried a `bds-locale` cookie
          // (set by the locale-switcher on a pre-signup screen, or by
          // the cookie-only middleware on first visit), stamp the new
          // row so the user lands in the language they already chose
          // instead of the DB default. AuthController seeds the
          // AsyncLocalStorage; outside that wrap this is a no-op.
          // Better-Auth's User type doesn't know about our custom
          // `locale` column, so we issue an unconditional update when
          // a cookie locale is present — if it matches the DB default
          // the write is a no-op cost-wise.
          const cookieLocale = getCookieLocale();
          if (cookieLocale) {
            try {
              await prisma.user.update({
                where: { id: user.id },
                data: { locale: cookieLocale },
              });
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('[auth] failed to stamp user.locale on signup', err);
            }
          }

          await writeAuthAudit({
            actorId: user.id,
            action: 'user.signup',
            target: `User:${user.id}`,
            meta: { via: 'email', locale: cookieLocale ?? null },
            ip: null,
            userAgent: null,
          });
          try {
            getPostHog()?.capture({
              distinctId: user.id,
              event: 'user.signed_up',
              properties: { via: 'email' },
            });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[auth] posthog user.signed_up capture failed', err);
          }
        },
      },
    },
  },

  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 10, // 10 min
      async sendVerificationOTP({ email, otp, type }) {
        const send = getMailer();
        const { subject, html, text } = renderOtpTemplate({ otp, type });
        await send({ to: email, subject, html, text });
      },
    }),
    magicLink({
      expiresIn: 60 * 10,
      async sendMagicLink({ email, url }) {
        const send = getMailer();
        const { subject, html, text } = renderMagicLinkTemplate({ url });
        await send({ to: email, subject, html, text });
      },
    }),
  ],
});

export type Auth = typeof auth;
