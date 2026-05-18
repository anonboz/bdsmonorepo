import { tailwindPreset } from '@repo/config/tailwind';
import animate from 'tailwindcss-animate';
import type { Config } from 'tailwindcss';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const uiPkgDir = path.dirname(require.resolve('@repo/ui/package.json'));

const config: Config = {
  presets: [tailwindPreset],
  content: [
    './app/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    `${uiPkgDir}/src/**/*.{ts,tsx}`,
  ],
  plugins: [animate],
};

export default config;
