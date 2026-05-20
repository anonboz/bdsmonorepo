import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const apiBaseURL = process.env.API_BASE_URL ?? 'http://localhost:3001';

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

  // Boot the API only if one isn't already running. Devs running
  // `pnpm turbo dev` get instant reuse; CI / cold runs get a fresh boot.
  webServer: {
    command: 'pnpm --filter @repo/api dev',
    url: `${apiBaseURL}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  },

  projects: [
    {
      name: 'api',
      use: { baseURL: apiBaseURL },
    },
  ],
});
