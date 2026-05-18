// @ts-check
import { baseConfig } from './base.js';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-process-env': 'off',
    },
  },
];
