import { expect, test } from '@playwright/test';

import type { Application, Campaign, House, Unit } from '@repo/shared';

import { loginAs } from '../lib/api.js';

/**
 * Owner posts a campaign on a vacant unit → submits PENDING → admin
 * approves → tenant applies → owner accepts. Accept is the heavy
 * transaction: it creates a DRAFT lease tying the unit to the
 * applicant, closes the campaign, and rejects any other applications.
 * We assert the createdLeaseId comes back and the campaign flips to
 * CLOSED.
 */
test('owner posts campaign → admin approves → tenant applies → owner accepts', async () => {
  const owner = await loginAs('owner');
  const admin = await loginAs('admin');
  const tenant = await loginAs('tenant');

  try {
    const house = await owner.post<House>('/v1/houses', {
      name: `Campaign House ${Date.now()}`,
      address: { line1: '3 Sublease Ln', city: 'Hanoi', country: 'VN' },
      isPublished: true,
    });
    const unit = await owner.post<Unit>(`/v1/houses/${house.id}/units`, {
      label: 'C1',
      status: 'VACANT',
      bedrooms: 2,
      bathrooms: 1,
    });

    const draft = await owner.post<Campaign>(`/v1/houses/${house.id}/units/${unit.id}/campaigns`, {
      title: 'Bright 2BR available now',
      body: 'Renovated unit, balcony, near transit.',
      price: 6_000_00,
      currency: 'VND',
    });
    expect(draft.status).toBe('DRAFT');

    const submitted = await owner.post<Campaign>(
      `/v1/houses/${house.id}/units/${unit.id}/campaigns/${draft.id}/transitions`,
      { to: 'PENDING' },
    );
    expect(submitted.status).toBe('PENDING');

    const approved = await admin.post<Campaign>(`/v1/admin/campaigns/${draft.id}/approve`, {});
    expect(approved.status).toBe('LIVE');
    expect(approved.publishedAt).not.toBeNull();

    const application = await tenant.post<Application>('/v1/me/applications', {
      campaignId: draft.id,
      message: 'Hi — I would love to view this unit.',
    });
    expect(application.status).toBe('SUBMITTED');

    const accepted = await owner.post<Application>(
      `/v1/houses/${house.id}/units/${unit.id}/campaigns/${draft.id}/applications/${application.id}/accept`,
    );
    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.createdLeaseId, 'accept should mint a DRAFT lease').not.toBeNull();

    // The campaign closes automatically — its listing is filled.
    const finalCampaign = await owner.get<Campaign>(
      `/v1/houses/${house.id}/units/${unit.id}/campaigns/${draft.id}`,
    );
    expect(finalCampaign.status).toBe('CLOSED');
  } finally {
    await owner.dispose();
    await admin.dispose();
    await tenant.dispose();
  }
});
