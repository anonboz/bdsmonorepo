import { describe, expect, it, vi } from 'vitest';

import { AnalyticsService } from './analytics.service.js';

function fakeClient() {
  return {
    capture: vi.fn(),
    identify: vi.fn(),
    _shutdown: vi.fn(() => Promise.resolve()),
  };
}

describe('AnalyticsService', () => {
  it('no-ops when no PostHog client is available', () => {
    // Default constructor in the unit-test env: POSTHOG_KEY is unset
    // and no override passed → first call lazy-inits to `null`.
    const service = new AnalyticsService();
    expect(() =>
      service.capture({ userId: 'u1', event: 'bill.paid', properties: { role: 'TENANT' } }),
    ).not.toThrow();
    expect(() => service.identify({ userId: 'u1', roles: ['TENANT'] })).not.toThrow();
  });

  it('forwards capture to the underlying PostHog client', () => {
    const client = fakeClient();
    const service = new AnalyticsService(client as never);
    service.capture({
      userId: 'u1',
      event: 'bill.paid',
      properties: { role: 'TENANT', amount: 100, currency: 'VND' },
    });
    expect(client.capture).toHaveBeenCalledOnce();
    expect(client.capture).toHaveBeenCalledWith({
      distinctId: 'u1',
      event: 'bill.paid',
      properties: { role: 'TENANT', amount: 100, currency: 'VND' },
    });
  });

  it('identify sets the role array as both top-level and $set', () => {
    const client = fakeClient();
    const service = new AnalyticsService(client as never);
    service.identify({ userId: 'u1', roles: ['TENANT', 'OWNER'] });
    expect(client.identify).toHaveBeenCalledWith({
      distinctId: 'u1',
      properties: {
        role: ['TENANT', 'OWNER'],
        $set: { role: ['TENANT', 'OWNER'] },
      },
    });
  });

  it('swallows capture errors so a domain handler never 500s on analytics failure', () => {
    const client = fakeClient();
    client.capture.mockImplementation(() => {
      throw new Error('ECONNREFUSED');
    });
    const service = new AnalyticsService(client as never);
    expect(() =>
      service.capture({ userId: 'u1', event: 'bill.paid', properties: { role: 'TENANT' } }),
    ).not.toThrow();
  });

  it('onModuleDestroy flushes the buffered queue when a client is set', async () => {
    const client = fakeClient();
    const service = new AnalyticsService(client as never);
    await service.onModuleDestroy();
    expect(client._shutdown).toHaveBeenCalledWith(2_000);
  });

  it('onModuleDestroy is a no-op when no client was ever constructed', async () => {
    const service = new AnalyticsService();
    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });
});
