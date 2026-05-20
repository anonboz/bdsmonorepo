import { nodeConfig } from '@repo/config/eslint/node';

export default [
  ...nodeConfig,
  {
    ignores: ['playwright-report/**', 'test-results/**'],
  },
  {
    // Playwright config + global setup must use default exports — both
    // are the documented hook surface and the loader expects them.
    files: ['playwright.config.ts', 'global-setup.ts'],
    rules: { 'import/no-default-export': 'off' },
  },
];
