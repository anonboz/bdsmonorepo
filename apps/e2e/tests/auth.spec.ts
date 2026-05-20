import { expect, test } from '@playwright/test';

import { prisma } from '@repo/db';
import type { MeResponse } from '@repo/shared';

import { loginAs } from '../lib/auth.js';
import { TEST_USERS, type TestUserKey } from '../lib/users.js';

/**
 * One happy-path per role. Each test:
 *   1. Runs the OTP login flow via the API.
 *   2. Calls GET /v1/me with the resulting session cookie.
 *   3. Asserts the user matches the seeded fixture for that role.
 *   4. Asserts an `auth.login` audit row was written (Phase 3.5).
 *
 * Suspended-user / wrong-role cases live in unit tests; the e2e job
 * here is to prove the wiring is real.
 */
test.describe('auth login per role', () => {
  for (const key of Object.keys(TEST_USERS) as TestUserKey[]) {
    const fixture = TEST_USERS[key];

    test(`logs in as ${key}`, async () => {
      const { ctx, userId, email } = await loginAs(key);

      try {
        const res = await ctx.get('/v1/me');
        expect(res.ok(), `GET /v1/me failed (${res.status()})`).toBe(true);

        const body = (await res.json()) as MeResponse;
        expect(body.user.id).toBe(userId);
        expect(body.user.email).toBe(email);
        expect(body.user.displayName).toBe(fixture.displayName);
        expect(body.user.roles).toEqual([fixture.role]);
        expect(body.user.isSuspended).toBe(false);

        // The session.create.after hook fires after better-auth writes the
        // session. Confirm the audit row landed for this user.
        const auditCount = await prisma.auditLog.count({
          where: { action: 'auth.login', actorId: userId },
        });
        expect(auditCount).toBeGreaterThanOrEqual(1);
      } finally {
        await ctx.dispose();
      }
    });
  }
});
