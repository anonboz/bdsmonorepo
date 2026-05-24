import { describe, expect, it } from 'vitest';

import { Locale } from '@repo/shared';

import { getCookieLocale, runWithLocale } from './locale-context.js';

describe('locale-context', () => {
  it('returns null outside any run() wrap', () => {
    expect(getCookieLocale()).toBeNull();
  });

  it('exposes the seeded cookie locale to async callees inside the wrap', async () => {
    let inside: ReturnType<typeof getCookieLocale> = null;
    await runWithLocale(Locale.en, async () => {
      // simulate the better-auth handler resolving asynchronously
      await new Promise((r) => setTimeout(r, 0));
      inside = getCookieLocale();
    });
    expect(inside).toBe(Locale.en);
    // Store is scoped to the run — no leakage outside.
    expect(getCookieLocale()).toBeNull();
  });

  it('treats a null cookie as null inside the wrap', async () => {
    await runWithLocale(null, () => {
      expect(getCookieLocale()).toBeNull();
      return Promise.resolve();
    });
  });
});
