import { expect, test } from '@playwright/test';

import type { House, Lease, LeaseRating, LeaseRatingState, Ticket, Unit } from '@repo/shared';

import { loginAs } from '../lib/api.js';

/**
 * Tenant raises a REPAIR ticket on an active lease, the owner walks
 * it ACK → IN_PROGRESS → RESOLVED, then the tenant submits a MOVE_IN
 * rating (open immediately because the lease's startDate is in the
 * past). Touches tickets + ticket-message ownership + lease ratings
 * in one chain.
 */
test('tenant raises ticket → owner resolves → tenant rates lease', async () => {
  const owner = await loginAs('owner');
  const tenant = await loginAs('tenant');

  try {
    const house = await owner.post<House>('/v1/houses', {
      name: `Ticket House ${Date.now()}`,
      address: { line1: '2 Repair Rd', city: 'Hanoi', country: 'VN' },
      isPublished: false,
    });
    const unit = await owner.post<Unit>(`/v1/houses/${house.id}/units`, {
      label: 'B1',
      status: 'VACANT',
      bedrooms: 1,
      bathrooms: 1,
    });
    const draftLease = await owner.post<Lease>(`/v1/houses/${house.id}/units/${unit.id}/leases`, {
      tenantId: tenant.userId,
      rentAmount: 4_000_00,
      depositAmount: 4_000_00,
      currency: 'VND',
      startDate: isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)),
    });
    await owner.post<Lease>(
      `/v1/houses/${house.id}/units/${unit.id}/leases/${draftLease.id}/transitions`,
      { to: 'ACTIVE' },
    );

    const ticket = await tenant.post<Ticket>('/v1/me/tickets', {
      leaseId: draftLease.id,
      category: 'REPAIR',
      title: 'Leaky tap',
      body: 'The kitchen tap drips constantly.',
    });
    expect(ticket.status).toBe('OPEN');

    const acked = await owner.post<Ticket>(`/v1/me/owner-tickets/${ticket.id}/transitions`, {
      to: 'ACKNOWLEDGED',
    });
    expect(acked.status).toBe('ACKNOWLEDGED');

    const inProgress = await owner.post<Ticket>(`/v1/me/owner-tickets/${ticket.id}/transitions`, {
      to: 'IN_PROGRESS',
    });
    expect(inProgress.status).toBe('IN_PROGRESS');

    const resolved = await owner.post<Ticket>(`/v1/me/owner-tickets/${ticket.id}/transitions`, {
      to: 'RESOLVED',
    });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).not.toBeNull();

    const state = await tenant.get<LeaseRatingState>(`/v1/me/leases/${draftLease.id}/rating-state`);
    const moveIn = state.milestones.find((m) => m.milestone === 'MOVE_IN');
    expect(moveIn?.isOpen, 'MOVE_IN should be open after the lease start').toBe(true);

    const rating = await tenant.post<LeaseRating>(`/v1/me/leases/${draftLease.id}/ratings`, {
      milestone: 'MOVE_IN',
      score: 5,
      comment: 'Great owner — handled the leaky tap fast.',
    });
    expect(rating.score).toBe(5);
    expect(rating.direction).toBe('TENANT_TO_OWNER');

    // Double-submit → 409 ratings.already_given.
    const dup = await tenant.raw.post(`/v1/me/leases/${draftLease.id}/ratings`, {
      data: { milestone: 'MOVE_IN', score: 4 },
    });
    expect(dup.status()).toBe(409);
  } finally {
    await owner.dispose();
    await tenant.dispose();
  }
});

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
