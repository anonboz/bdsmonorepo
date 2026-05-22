import { vi } from 'vitest';

import type { AnalyticsService } from './analytics.service.js';

/**
 * Stub AnalyticsService for unit specs. Returns no-op `capture` and
 * `identify` mocks — individual tests can assert call counts /
 * arguments when they care. `onModuleDestroy` is also stubbed so
 * Nest test modules don't error on shutdown.
 */
export function stubAnalytics(): AnalyticsService {
  return {
    capture: vi.fn(),
    identify: vi.fn(),
    onModuleDestroy: vi.fn(() => Promise.resolve()),
  } as unknown as AnalyticsService;
}
