// @ts-check
import { reactConfig } from './react.js';
import nextPlugin from '@next/eslint-plugin-next';

/** @type {import('eslint').Linter.Config[]} */
export const nextjsConfig = [
  ...reactConfig,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['app/**/{page,layout,loading,error,not-found,template,default}.{ts,tsx}'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
  {
    files: ['next.config.{js,mjs,ts}', 'middleware.{js,ts}'],
    rules: {
      'import/no-default-export': 'off',
    },
  },
];
