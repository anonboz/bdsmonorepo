import { afterEach, describe, expect, it, vi } from 'vitest';

// The env loader runs at import time and `POSTHOG_KEY` is absent in
// the unit-test env, so `getPostHog()` returns null in production
// without any flagging. The test-only `setPostHogForTests` hook
// swaps the cached value to verify the singleton's caller-facing
// behavior.
import { getPostHog, setPostHogForTests } from './analytics.client.js';

afterEach(() => {
  setPostHogForTests(undefined);
});

describe('getPostHog', () => {
  it('returns null when POSTHOG_KEY is unset (the unit-test default)', () => {
    expect(getPostHog()).toBeNull();
  });

  it('returns the cached client across calls once seeded', () => {
    const fake = { capture: vi.fn() } as unknown as ReturnType<typeof getPostHog>;
    setPostHogForTests(fake);
    expect(getPostHog()).toBe(fake);
    // Repeat call returns the same instance — singleton, not factory.
    expect(getPostHog()).toBe(fake);
  });

  it('setPostHogForTests(undefined) clears the cache so the next call re-resolves', () => {
    const fake = { capture: vi.fn() } as unknown as ReturnType<typeof getPostHog>;
    setPostHogForTests(fake);
    setPostHogForTests(undefined);
    // After reset + with no POSTHOG_KEY in env, we land on null.
    expect(getPostHog()).toBeNull();
  });
});
