import { request, type APIRequestContext } from '@playwright/test';

import { prisma } from '@repo/db';

import { TEST_USERS, type TestUserKey } from './users.js';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';

/**
 * Issues the better-auth OTP flow against the API and returns an
 * `APIRequestContext` carrying the session cookie. Steps:
 *
 *   1. POST /v1/auth/email-otp/send-verification-otp  → creates a
 *      Verification row with identifier `sign-in-otp-<email>`.
 *   2. SELECT value FROM Verification WHERE identifier = ... — better-auth
 *      stores the OTP plaintext (our config uses the default `storeOTP:
 *      "plain"`). The value may be suffixed with `:<attempts>` after
 *      bad attempts; we split on the last colon.
 *   3. POST /v1/auth/sign-in/email-otp with the OTP. Better-auth sets
 *      the session cookie via Set-Cookie; the `APIRequestContext`
 *      retains it for subsequent calls.
 *
 * The returned context is the caller's responsibility to dispose of
 * via `ctx.dispose()` (Playwright will GC it at end of test if the
 * caller forgets, but explicit is cleaner).
 */
export async function loginAs(
  key: TestUserKey,
): Promise<{ ctx: APIRequestContext; userId: string; email: string }> {
  const { email } = TEST_USERS[key];

  const ctx = await request.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'content-type': 'application/json' },
  });

  const sendRes = await ctx.post('/v1/auth/email-otp/send-verification-otp', {
    data: { email, type: 'sign-in' },
  });
  if (!sendRes.ok()) {
    throw new Error(`send-verification-otp failed (${sendRes.status()}): ${await sendRes.text()}`);
  }

  const otp = await readLatestSignInOTP(email);

  const verifyRes = await ctx.post('/v1/auth/sign-in/email-otp', {
    data: { email, otp },
  });
  if (!verifyRes.ok()) {
    throw new Error(`sign-in/email-otp failed (${verifyRes.status()}): ${await verifyRes.text()}`);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`Seeded test user missing for email ${email}`);

  return { ctx, userId: user.id, email };
}

/**
 * Reads the latest `sign-in-otp-<email>` value from `Verification` and
 * returns the OTP code. Strips any `:<attempts>` suffix that better-auth
 * appends after a failed attempt (not expected during a fresh login,
 * but defensive — see better-auth's `routes.mjs` atomicVerifyOTP).
 */
async function readLatestSignInOTP(email: string): Promise<string> {
  const row = await prisma.verification.findFirst({
    where: { identifier: `sign-in-otp-${email}` },
    orderBy: { createdAt: 'desc' },
    select: { value: true },
  });
  if (!row) {
    throw new Error(`No Verification row found for sign-in-otp-${email}.`);
  }
  const colon = row.value.lastIndexOf(':');
  return colon === -1 ? row.value : row.value.slice(0, colon);
}
