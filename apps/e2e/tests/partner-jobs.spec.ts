import { expect, test } from '@playwright/test';

import type {
  JobLedgerEntry,
  JobRating,
  JobRatingsForJob,
  Page,
  PartnerProfile,
  ServiceJob,
  Service,
} from '@repo/shared';

import { loginAs } from '../lib/api.js';

/**
 * Full partner-job round trip: partner registers a service, owner
 * books it, the multi-party state machine runs all the way to
 * COMPLETED, the ledger mints three rows summing to zero, and both
 * sides rate each other. Stitches 5.1 → 5.2 → 5.4 → 5.5 together.
 */
test('owner books partner → completion → ledger + ratings', async () => {
  const partner = await loginAs('partner');
  const owner = await loginAs('owner');

  try {
    const partnerProfile = await partner.get<PartnerProfile>('/v1/me/partner-profile');
    const service = await partner.post<Service>('/v1/me/services', {
      name: 'Plumbing 1h',
      basePrice: 50_000,
      currency: 'VND',
      isActive: true,
    });
    expect(service.isActive).toBe(true);

    const job = await owner.post<ServiceJob>('/v1/me/service-jobs', {
      partnerId: partnerProfile.id,
      serviceId: service.id,
      description: 'Kitchen tap is leaking — replace washer.',
    });
    expect(job.status).toBe('REQUESTED');

    const quoted = await partner.post<ServiceJob>(`/v1/me/jobs/${job.id}/quote`, {
      amount: 50_000,
      currency: 'VND',
    });
    expect(quoted.status).toBe('QUOTED');
    expect(quoted.quotedAmount).toBe(50_000);

    const accepted = await owner.post<ServiceJob>(`/v1/me/service-jobs/${job.id}/accept`);
    expect(accepted.status).toBe('ACCEPTED');

    const started = await partner.post<ServiceJob>(`/v1/me/jobs/${job.id}/start`);
    expect(started.status).toBe('IN_PROGRESS');

    const completed = await partner.post<ServiceJob>(`/v1/me/jobs/${job.id}/complete`, {
      finalAmount: 50_000,
      proofPhotos: [],
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.finalAmount).toBe(50_000);

    // Three ledger rows: CHARGE (owner, −50_000), COMMISSION (null, +5_000),
    // PAYOUT (partner, +45_000 HELD). Sum is zero by construction.
    const partnerPayouts = await partner.get<Page<JobLedgerEntry>>('/v1/me/payouts?limit=50');
    const heldRow = partnerPayouts.items.find(
      (e) => e.jobId === job.id && e.kind === 'PAYOUT' && e.status === 'HELD',
    );
    expect(heldRow, 'partner should have one HELD payout row for this job').toBeDefined();
    expect(heldRow?.amount).toBe(45_000);
    expect(heldRow?.cooldownUntil).not.toBeNull();

    const ownerCharges = await owner.get<Page<JobLedgerEntry>>('/v1/me/charges?limit=50');
    const chargeRow = ownerCharges.items.find((e) => e.jobId === job.id && e.kind === 'CHARGE');
    expect(chargeRow, 'owner should have a CHARGE row for this job').toBeDefined();
    expect(chargeRow?.amount).toBe(-50_000);

    const ownerRating = await owner.post<JobRating>(`/v1/me/service-jobs/${job.id}/rating`, {
      score: 5,
      comment: 'Quick, clean work.',
    });
    expect(ownerRating.direction).toBe('OWNER_TO_PARTNER');

    const partnerRating = await partner.post<JobRating>(`/v1/me/jobs/${job.id}/rating`, {
      score: 4,
    });
    expect(partnerRating.direction).toBe('PARTNER_TO_OWNER');

    const state = await owner.get<JobRatingsForJob>(`/v1/me/service-jobs/${job.id}/ratings`);
    expect(state.ownerToPartner?.score).toBe(5);
    expect(state.partnerToOwner?.score).toBe(4);
  } finally {
    await partner.dispose();
    await owner.dispose();
  }
});
