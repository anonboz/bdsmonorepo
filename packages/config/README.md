# @repo/config

Shared toolchain config for the monorepo: TypeScript presets, ESLint flat configs,
Prettier preset, Tailwind preset, and a Zod-validated env loader.

## Usage

### TypeScript

```jsonc
// apps/api/tsconfig.json
{
  "extends": "@repo/config/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
}
```

Variants:

- `@repo/config/tsconfig/base.json` — language defaults, no env-specific lib
- `@repo/config/tsconfig/node.json` — for backend / CLI / scripts
- `@repo/config/tsconfig/nextjs.json` — for Next.js apps
- `@repo/config/tsconfig/react-library.json` — for shared React component packages

### ESLint (flat)

```js
// apps/api/eslint.config.js
import { nodeConfig } from '@repo/config/eslint/node';
export default nodeConfig;
```

Variants: `eslint/base`, `eslint/node`, `eslint/react`, `eslint/nextjs`.

### Prettier

```js
// .prettierrc.js
import { prettierConfig } from '@repo/config/prettier';
export default prettierConfig;
```

### Tailwind

```ts
// apps/admin/tailwind.config.ts
import { tailwindPreset } from '@repo/config/tailwind';
import type { Config } from 'tailwindcss';

export default {
  presets: [tailwindPreset],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
} satisfies Config;
```

### Env loader

```ts
import { z } from 'zod';
import { databaseUrl, loadEnv, nodeEnv, port } from '@repo/config/env';

export const env = loadEnv(
  z.object({
    NODE_ENV: nodeEnv,
    PORT: port.default(3001),
    DATABASE_URL: databaseUrl,
  }),
);
```
