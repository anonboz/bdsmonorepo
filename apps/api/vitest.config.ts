import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/*.e2e.{test,spec}.ts', 'node_modules/**', 'dist/**'],
  },
  esbuild: {
    target: 'es2022',
  },
});
