import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const apiBaseURL = process.env.API_BASE_URL ?? 'http://localhost:4001';
const tenantBaseURL = process.env.TENANT_BASE_URL ?? 'http://localhost:4020';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  // Single worker — the suite shares one DB and global setup truncates
  // tables. Parallel workers would race on those resets. 6.2 will revisit
  // once we need per-worker schemas.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: fileURLToPath(new URL('./global-setup.ts', import.meta.url)),

  use: {
    baseURL: apiBaseURL,
    extraHTTPHeaders: { 'content-type': 'application/json' },
    trace: 'on-first-retry',
  },

  // Boot the API + tenant dev servers only if they aren't already
  // running. Devs running `pnpm turbo dev` get instant reuse; CI / cold
  // runs get a fresh boot. The tenant boot is gated to the browser
  // project; API tests don't need it but the plugin doesn't support
  // per-project servers in v1.48, so we accept the (cached) cost.
  webServer: [
    {
      command: 'pnpm --filter @repo/api dev',
      url: `${apiBaseURL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
    },
    {
      command: 'pnpm --filter @repo/tenant dev',
      url: tenantBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
    },
  ],

  projects: [
    {
      name: 'api',
      // Default `extraHTTPHeaders` from the top-level `use` covers JSON
      // — explicit override only when a per-project setting diverges.
      testIgnore: ['**/web/**'],
      use: { baseURL: apiBaseURL },
    },
    {
      // Phase 11.3 — browser-driven happy-path coverage. Only files
      // under `tests/web/` run here; the API project ignores them.
      name: 'tenant-web',
      testMatch: ['**/web/**/*.spec.ts'],
      use: {
        ...devices['Pixel 7'],
        baseURL: tenantBaseURL,
        // Override the API-shaped JSON header — browser tests post
        // form fields, click buttons, etc.
        extraHTTPHeaders: undefined,
      },
    },
  ],
});
