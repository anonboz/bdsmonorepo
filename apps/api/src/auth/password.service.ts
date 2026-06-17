import { Inject, Injectable } from '@nestjs/common';

import { ErrorCodes } from '@repo/shared';

import { auth } from './better-auth.config.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

/** better-auth stores password logins on an Account row with this providerId. */
const CREDENTIAL_PROVIDER = 'credential';

/**
 * Phase 12.6 — wraps the two password operations the API owns so the
 * controllers (and their unit tests) don't import better-auth directly:
 *
 * - `hasPassword` reads whether a credential Account row exists.
 * - `setPassword` delegates to better-auth, which creates that row.
 */
@Injectable()
export class PasswordService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  /** True when the user has a credential account with a password set. */
  async hasPassword(userId: string): Promise<boolean> {
    const count = await this.prisma.account.count({
      where: { userId, providerId: CREDENTIAL_PROVIDER, password: { not: null } },
    });
    return count > 0;
  }

  /**
   * Set the session user's password. The session is resolved by
   * better-auth from the forwarded request headers — the same cookie
   * AuthGuard already validated. Used for OTP-first users adding a
   * password; better-auth rejects a re-set when one already exists
   * (a dedicated change-password flow is a follow-up).
   */
  async setPassword(headers: Headers, newPassword: string): Promise<void> {
    try {
      await auth.api.setPassword({ body: { newPassword }, headers });
    } catch {
      throw new ProblemError({
        status: 400,
        type: ErrorCodes.AUTH_INVALID_CREDENTIALS,
        title: 'Could not set password',
        detail: 'A password could not be set for this account.',
      });
    }
  }
}
