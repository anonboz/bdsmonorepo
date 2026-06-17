import { expect, request, test } from '@playwright/test';

import { prisma } from '@repo/db';
import type { MeResponse } from '@repo/shared';

import { loginAs } from '../lib/auth.js';
import { TEST_USERS } from '../lib/users.js';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4001';

// A verified phone the seed doesn't assign, so it can't collide with the
// other (phone-less) seeded users. `User.phone` is unique.
const PHONE = '+14155550199';
const PASSWORD = 'Passw0rd!23';

function freshContext() {
  return request.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: { 'content-type': 'application/json' },
  });
}

/**
 * Phase 12.6 happy-path: an OTP-first user sets a login password, signs
 * out, then signs back in with phone + password.
 *
 *   1. Stamp a verified phone on the owner (the seed makes phone-less
 *      users; `requireVerification: true` gates password sign-in on a
 *      verified phone). Also drop any leftover credential account so the
 *      test is idempotent across retries.
 *   2. OTP login → POST /v1/me/set-password → /v1/me shows hasPassword.
 *   3. Sign out, then sign in on a fresh context with phone + password.
 *   4. Wrong password is rejected (enumeration-safe 401).
 */
test.describe('phone + password sign-in', () => {
  test('set password via OTP session, then sign in with phone + password', async () => {
    const { email } = TEST_USERS.owner;

    await prisma.account.deleteMany({
      where: { user: { email }, providerId: 'credential' },
    });
    const seeded = await prisma.user.update({
      where: { email },
      data: { phone: PHONE, phoneVerified: true },
      select: { id: true },
    });

    // 1. OTP login → authenticated session.
    const { ctx, userId } = await loginAs('owner');
    try {
      const before = (await (await ctx.get('/v1/me')).json()) as MeResponse;
      expect(before.hasPassword).toBe(false);

      // 2. Set a password.
      const setRes = await ctx.post('/v1/me/set-password', { data: { newPassword: PASSWORD } });
      expect(setRes.status(), await setRes.text()).toBe(204);

      const after = (await (await ctx.get('/v1/me')).json()) as MeResponse;
      expect(after.hasPassword).toBe(true);

      // 3. Sign out the OTP session.
      const outRes = await ctx.post('/v1/auth/sign-out');
      expect(outRes.ok(), `sign-out failed (${outRes.status()})`).toBe(true);
    } finally {
      await ctx.dispose();
    }

    // 4. Fresh (signed-out) context → sign in with phone + password.
    const fresh = await freshContext();
    try {
      const signin = await fresh.post('/v1/auth/sign-in/phone-number', {
        data: { phoneNumber: PHONE, password: PASSWORD },
      });
      expect(signin.status(), await signin.text()).toBe(200);

      const me = (await (await fresh.get('/v1/me')).json()) as MeResponse;
      expect(me.user.id).toBe(userId);
      expect(me.user.id).toBe(seeded.id);
      expect(me.hasPassword).toBe(true);
    } finally {
      await fresh.dispose();
    }

    // 5. Wrong password is rejected.
    const bad = await freshContext();
    try {
      const badRes = await bad.post('/v1/auth/sign-in/phone-number', {
        data: { phoneNumber: PHONE, password: 'wrong-password-xyz' },
      });
      expect(badRes.status()).toBe(401);
    } finally {
      await bad.dispose();
    }
  });
});
