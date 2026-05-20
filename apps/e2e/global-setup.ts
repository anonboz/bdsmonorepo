import { createId, prisma } from '@repo/db';

import { TEST_USERS } from './lib/users.js';

/**
 * Playwright global setup. Runs once before any test.
 *
 * 1. Refuses to run against a production-flagged environment.
 * 2. Wipes every table in dependency order — the suite must start
 *    from a deterministic state.
 * 3. Seeds exactly one user per role (plus a partner profile) so
 *    tests can refer to roles by name without poking IDs.
 *
 * The order of deletes matches `packages/db/src/seed.ts` — children
 * before parents. Keep them in sync when new tables land.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run e2e setup in production.');
  }

  assertLocalDatabase(process.env.DATABASE_URL);

  // eslint-disable-next-line no-console
  console.log('[e2e] resetting database…');

  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.jobRating.deleteMany();
  await prisma.jobLedgerEntry.deleteMany();
  await prisma.serviceJob.deleteMany();
  await prisma.service.deleteMany();
  await prisma.partnerProfile.deleteMany();
  await prisma.application.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.billLine.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.leaseRating.deleteMany();
  await prisma.ticketMessage.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.house.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  // eslint-disable-next-line no-console
  console.log('[e2e] seeding test users…');

  for (const user of Object.values(TEST_USERS)) {
    const row = await prisma.user.create({
      data: {
        id: createId(),
        email: user.email,
        displayName: user.displayName,
        emailVerified: true,
        roles: [user.role],
        kycStatus: 'APPROVED',
      },
    });
    if (user.role === 'PARTNER') {
      await prisma.partnerProfile.create({
        data: {
          id: createId(),
          userId: row.id,
          businessName: 'E2E Partner Co.',
          kycStatus: 'APPROVED',
        },
      });
    }
  }

  await prisma.$disconnect();
}

/**
 * Hard guard against pointing the e2e suite at anything that isn't a
 * throwaway local DB. The setup truncates every table — running it
 * against a shared dev or prod DB would erase real work. Accept only
 * loopback hostnames and the docker compose service name.
 */
function assertLocalDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set — point it at a local docker DB.');
  }
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${databaseUrl}`);
  }
  const ALLOWED = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db']);
  if (!ALLOWED.has(host)) {
    throw new Error(
      `Refusing to wipe non-local database at host "${host}". ` +
        `Set DATABASE_URL to a local docker DB before running e2e ` +
        `(e.g. postgresql://app:app@localhost:5432/app).`,
    );
  }
}
