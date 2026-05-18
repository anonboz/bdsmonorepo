/** @type {import('lint-staged').Config} */
module.exports = {
  '*.{ts,tsx,js,jsx}': ['pnpm exec prettier --write'],
  '*.{json,md,yml,yaml,css}': ['pnpm exec prettier --write'],
};
