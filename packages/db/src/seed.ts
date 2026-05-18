/* eslint-disable no-console */
import { createId } from '@paralleldrive/cuid2';

import { prisma } from './client.js';

/**
 * Deterministic seed: clears and re-inserts the baseline cast — 1 admin,
 * 2 owners, 4 tenants, 2 partners — plus enough houses/units/leases to
 * exercise the reference module and the bill/ticket flows in dev.
 *
 * Idempotent in spirit: it wipes tables in dependency order, then inserts.
 * Safe to run repeatedly in dev. NEVER run against production.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed in production.');
  }

  console.log('🌱 Resetting tables…');
  // Order matters: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.serviceJob.deleteMany();
  await prisma.service.deleteMany();
  await prisma.partnerProfile.deleteMany();
  await prisma.application.deleteMany();
  await prisma.campaign.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.billLine.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.house.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.verification.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  console.log('🌱 Inserting users…');

  const admin = await prisma.user.create({
    data: {
      id: createId(),
      email: 'admin@example.com',
      displayName: 'Admin One',
      emailVerified: true,
      roles: ['ADMIN'],
      kycStatus: 'APPROVED',
    },
  });

  const owners = await Promise.all(
    [
      ['owner1@example.com', 'Olivia Owner', '+14155550101'],
      ['owner2@example.com', 'Oscar Owner', '+14155550102'],
    ].map(([email, name, phone]) =>
      prisma.user.create({
        data: {
          id: createId(),
          email: email!,
          phone: phone!,
          displayName: name!,
          emailVerified: true,
          roles: ['OWNER'],
          kycStatus: 'APPROVED',
        },
      }),
    ),
  );

  const tenants = await Promise.all(
    [
      ['tenant1@example.com', 'Tara Tenant', '+14155550201'],
      ['tenant2@example.com', 'Theo Tenant', '+14155550202'],
      ['tenant3@example.com', 'Tina Tenant', '+14155550203'],
      ['tenant4@example.com', 'Tim Tenant', '+14155550204'],
    ].map(([email, name, phone]) =>
      prisma.user.create({
        data: {
          id: createId(),
          email: email!,
          phone: phone!,
          displayName: name!,
          emailVerified: true,
          roles: ['TENANT'],
          kycStatus: 'APPROVED',
        },
      }),
    ),
  );

  const partners = await Promise.all(
    [
      ['partner1@example.com', 'Pat Partner', '+14155550301', 'Pat Repairs Co.'],
      ['partner2@example.com', 'Pia Partner', '+14155550302', 'Pia Brokerage'],
    ].map(async ([email, name, phone, businessName]) => {
      const user = await prisma.user.create({
        data: {
          id: createId(),
          email: email!,
          phone: phone!,
          displayName: name!,
          emailVerified: true,
          roles: ['PARTNER'],
          kycStatus: 'APPROVED',
        },
      });
      await prisma.partnerProfile.create({
        data: {
          id: createId(),
          userId: user.id,
          businessName: businessName!,
          kycStatus: 'APPROVED',
        },
      });
      return user;
    }),
  );

  console.log('🌱 Inserting houses + units…');

  const [owner1] = owners;
  if (!owner1) throw new Error('Owner seed failed');

  const sunnyside = await prisma.house.create({
    data: {
      id: createId(),
      ownerId: owner1.id,
      name: 'Sunnyside Apartments',
      description: 'A pleasant 4-unit walk-up.',
      addressLine1: '123 Sunny St',
      city: 'Hanoi',
      country: 'VN',
      isPublished: true,
      units: {
        create: [
          { id: createId(), label: 'A1', status: 'OCCUPIED', bedrooms: 2, bathrooms: 1, sqm: 60 },
          { id: createId(), label: 'A2', status: 'OCCUPIED', bedrooms: 1, bathrooms: 1, sqm: 40 },
          { id: createId(), label: 'B1', status: 'VACANT', bedrooms: 2, bathrooms: 1, sqm: 65 },
          {
            id: createId(),
            label: 'B2',
            status: 'MAINTENANCE',
            bedrooms: 1,
            bathrooms: 1,
            sqm: 40,
          },
        ],
      },
    },
    include: { units: true },
  });

  const occupiedUnits = sunnyside.units.filter((u: { status: string }) => u.status === 'OCCUPIED');
  for (let i = 0; i < occupiedUnits.length; i++) {
    const unit = occupiedUnits[i]!;
    const tenant = tenants[i]!;
    await prisma.lease.create({
      data: {
        id: createId(),
        unitId: unit.id,
        tenantId: tenant.id,
        ownerId: owner1.id,
        status: 'ACTIVE',
        rentCycle: 'MONTHLY',
        rentAmount: 5_000_00, // 5,000,000 VND in minor units (xu)
        depositAmount: 5_000_00,
        currency: 'VND',
        startDate: new Date(Date.UTC(2026, 0, 1)),
      },
    });
  }

  const owner2 = owners[1]!;
  await prisma.house.create({
    data: {
      id: createId(),
      ownerId: owner2.id,
      name: 'Riverside Townhomes',
      addressLine1: '45 River Rd',
      city: 'Ho Chi Minh City',
      country: 'VN',
      isPublished: false,
      units: {
        create: [
          { id: createId(), label: '1', status: 'VACANT', bedrooms: 3, bathrooms: 2 },
          { id: createId(), label: '2', status: 'VACANT', bedrooms: 3, bathrooms: 2 },
        ],
      },
    },
  });

  console.log(`✅ Seeded ${1 + owners.length + tenants.length + partners.length} users.`);
  console.log(`   Admin:   ${admin.email}`);
  console.log(`   Owners:  ${owners.map((o) => o.email).join(', ')}`);
  console.log(`   Tenants: ${tenants.map((t) => t.email).join(', ')}`);
  console.log(`   Partners: ${partners.map((p) => p.email).join(', ')}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
