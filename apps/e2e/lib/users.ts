import type { Role } from '@repo/shared';

/**
 * Stable test-user roster seeded by `global-setup`. Emails and display
 * names are well-known so individual tests can refer to them by role
 * without poking at IDs. The seed creates exactly these rows on every
 * run.
 */
export interface TestUser {
  email: string;
  displayName: string;
  role: Role;
}

export const TEST_USERS = {
  admin: {
    email: 'e2e.admin@test.local',
    displayName: 'E2E Admin',
    role: 'ADMIN',
  },
  owner: {
    email: 'e2e.owner@test.local',
    displayName: 'E2E Owner',
    role: 'OWNER',
  },
  tenant: {
    email: 'e2e.tenant@test.local',
    displayName: 'E2E Tenant',
    role: 'TENANT',
  },
  partner: {
    email: 'e2e.partner@test.local',
    displayName: 'E2E Partner',
    role: 'PARTNER',
  },
} as const satisfies Record<string, TestUser>;

export type TestUserKey = keyof typeof TEST_USERS;
