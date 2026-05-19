import { nodeConfig } from '@repo/config/eslint/node';

export default [
  ...nodeConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // NestJS leans heavily on classes + decorators; ergonomics over strictness.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/parameter-properties': 'off',
    },
  },
];
