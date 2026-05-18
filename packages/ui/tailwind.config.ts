import { tailwindPreset } from '@repo/config/tailwind';
import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [tailwindPreset],
  content: ['./src/**/*.{ts,tsx}'],
};

export default config;
