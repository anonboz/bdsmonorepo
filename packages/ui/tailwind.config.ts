import { tailwindPreset } from '@repo/config/tailwind';
import animate from 'tailwindcss-animate';
import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}'],
  plugins: [animate],
};

export default config;
