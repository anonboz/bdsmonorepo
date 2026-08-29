// Idempotent seed for the live smoke test. Clears all tables (public schema) then
// inserts one primary org (Maple) with a full cast + data for every app's slice,
// plus a second org (Cedar) so the admin console has more than one row.
//
// All logins use password: 12345678
//   landlord@test.com (landlord) · agent@test.com (agent)
//   admin@test.com (admin) · vendor@test.com (vendor)
//   tenant1@test.com / tenant2@test.com (tenants)

import "dotenv/config";
import { db } from "../src/index";
import bcrypt from "bcryptjs";

async function reset() {
  // Delete children before parents (FK order).
  await db.payment.deleteMany();
  await db.invoiceLineItem.deleteMany();
  await db.rentInvoice.deleteMany();
  await db.orgUtilityRate.deleteMany();
  await db.utilityRateBound.deleteMany();
  await db.deposit.deleteMany();
  await db.tenancy.deleteMany();
  await db.workOrder.deleteMany();
  await db.maintenanceRequest.deleteMany();
  await db.inspection.deleteMany();
  await db.screening.deleteMany();
  await db.application.deleteMany();
  await db.lease.deleteMany();
  await db.listing.deleteMany();
  await db.unit.deleteMany();
  await db.vendor.deleteMany();
  await db.property.deleteMany();
  await db.orgMembership.deleteMany();
  await db.notification.deleteMany();
  await db.document.deleteMany();
  await db.auditLog.deleteMany();
  await db.featureFlag.deleteMany();
  await db.user.deleteMany();
  await db.organization.deleteMany();
}

async function main() {
  await reset();
  const passwordHash = await bcrypt.hash("12345678", 10);
  const user = (email: string, name: string) =>
    db.user.create({ data: { email, name, passwordHash } });

  const org = await db.organization.create({
    data: { name: "Maple Property Group", slug: "maple" },
  });
  const cedar = await db.organization.create({ data: { name: "Cedar Rentals", slug: "cedar" } });

  // Staff (org members) + tenants (no membership — they relate via Tenancy).
  const landlord = await user("landlord@test.com", "Otto Landlord");
  const agent = await user("agent@test.com", "Ava Agent");
  const admin = await user("admin@test.com", "Sam Admin");
  const vendorUser = await user("vendor@test.com", "Vince Vendor");
  const tenant1 = await user("tenant1@test.com", "Tara Tenant");
  const tenant2 = await user("tenant2@test.com", "Theo Tenant");

  await db.orgMembership.createMany({
    data: [
      { organizationId: org.id, userId: landlord.id, role: "landlord" },
      { organizationId: org.id, userId: agent.id, role: "agent" },
      { organizationId: org.id, userId: admin.id, role: "admin" },
      { organizationId: org.id, userId: vendorUser.id, role: "vendor" },
    ],
  });

  // Property + units (Maple).
  const property = await db.property.create({
    data: {
      organizationId: org.id,
      name: "Maple Court",
      type: "apartment",
      addressLine1: "12 Maple Street",
      city: "Portland",
      region: "OR",
      units: {
        create: [
          { label: "Apt 1A", bedrooms: 2, bathrooms: 1, rentAmount: 185000, status: "occupied" },
          { label: "Apt 1B", bedrooms: 1, bathrooms: 1, rentAmount: 145000, status: "available" },
        ],
      },
    },
    include: { units: true },
  });
  const apt1a = property.units.find((u) => u.label === "Apt 1A")!;
  const apt1b = property.units.find((u) => u.label === "Apt 1B")!;

  // Cedar gets a property/unit so the admin org list has real counts on row 2.
  await db.property.create({
    data: {
      organizationId: cedar.id,
      name: "Cedar Lofts",
      type: "condo",
      addressLine1: "88 Cedar Ave",
      city: "Seattle",
      region: "WA",
      units: { create: [{ label: "Loft 3", bedrooms: 2, bathrooms: 2, rentAmount: 240000 }] },
    },
  });

  // Active lease on Apt 1A (tenant1) — for landlord + tenant slices.
  const lease = await db.lease.create({
    data: {
      organizationId: org.id,
      unitId: apt1a.id,
      status: "active",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rentAmount: 185000,
      depositAmount: 185000,
      rentDueDay: 1,
      signedAt: new Date("2025-12-20"),
      tenancies: { create: { userId: tenant1.id, isPrimary: true } },
    },
  });

  // Utility pricing. The admin sets platform-wide min/max bounds (cents per unit);
  // the owner picks a per-org rate inside that gate. Invoice utility amounts are
  // then computed as round(consumption × the org's rate) — never hardcoded.
  await db.utilityRateBound.createMany({
    data: [
      { kind: "water", unit: "m³", minPricePerUnit: 1000, maxPricePerUnit: 5000 },
      { kind: "electricity", unit: "kWh", minPricePerUnit: 150, maxPricePerUnit: 600 },
    ],
  });
  const WATER_RATE = 2000; // cents per m³ (within [1000, 5000])
  const ELEC_RATE = 300; // cents per kWh (within [150, 600])
  await db.orgUtilityRate.createMany({
    data: [
      { organizationId: org.id, kind: "water", unit: "m³", pricePerUnit: WATER_RATE },
      { organizationId: org.id, kind: "electricity", unit: "kWh", pricePerUnit: ELEC_RATE },
    ],
  });

  // Rent invoices on that lease so the tenant "My bills" page has real rows.
  // Each invoice itemises rent + metered water (m³) + electricity (kWh); utility
  // amounts derive from consumption × the org's rate. May + June settled (full
  // payment), July overdue, August open. All money is integer cents.
  const RENT_CENTS = 185000;
  const invoice = (opts: {
    periodStart: string;
    periodEnd: string;
    dueDate: string;
    status: "paid" | "overdue" | "open";
    waterM3: number;
    elecKwh: number;
    payment?: { method: "card" | "bank_transfer"; paidAt: string };
  }) => {
    const waterCents = Math.round(opts.waterM3 * WATER_RATE);
    const elecCents = Math.round(opts.elecKwh * ELEC_RATE);
    const total = RENT_CENTS + waterCents + elecCents;
    return db.rentInvoice.create({
      data: {
        organizationId: org.id,
        leaseId: lease.id,
        periodStart: new Date(opts.periodStart),
        periodEnd: new Date(opts.periodEnd),
        dueDate: new Date(opts.dueDate),
        amount: total,
        status: opts.status,
        lineItems: {
          create: [
            { kind: "rent", description: "Monthly rent", amount: RENT_CENTS },
            {
              kind: "water",
              description: "Water",
              quantity: opts.waterM3,
              unit: "m³",
              amount: waterCents,
            },
            {
              kind: "electricity",
              description: "Electricity",
              quantity: opts.elecKwh,
              unit: "kWh",
              amount: elecCents,
            },
          ],
        },
        ...(opts.payment
          ? {
              payments: {
                create: {
                  amount: total,
                  method: opts.payment.method,
                  status: "succeeded",
                  paidAt: new Date(opts.payment.paidAt),
                },
              },
            }
          : {}),
      },
    });
  };

  await invoice({
    periodStart: "2026-05-01",
    periodEnd: "2026-05-31",
    dueDate: "2026-05-01",
    status: "paid",
    waterM3: 11,
    elecKwh: 195,
    payment: { method: "card", paidAt: "2026-04-29" },
  });
  await invoice({
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    dueDate: "2026-06-01",
    status: "paid",
    waterM3: 12.5,
    elecKwh: 210,
    payment: { method: "bank_transfer", paidAt: "2026-06-02" },
  });
  await invoice({
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    dueDate: "2026-07-01",
    status: "overdue",
    waterM3: 13.2,
    elecKwh: 240,
  });
  await invoice({
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    dueDate: "2026-08-01",
    status: "open",
    waterM3: 12,
    elecKwh: 205,
  });

  // Published listing on the vacant Apt 1B — for the listings site + agent slice.
  const listing = await db.listing.create({
    data: {
      organizationId: org.id,
      unitId: apt1b.id,
      title: "Bright 1BR at Maple Court",
      description: "Sunny one-bedroom with hardwood floors, near the park.",
      rentAmount: 145000,
      depositAmount: 145000,
      availableFrom: new Date("2026-08-01"),
      status: "published",
      publishedAt: new Date("2026-07-01"),
    },
  });

  // Application from tenant2 on that listing (+ pending screening) — agent slice.
  await db.application.create({
    data: {
      organizationId: org.id,
      listingId: listing.id,
      applicantUserId: tenant2.id,
      status: "submitted",
      moveInDate: new Date("2026-08-15"),
      message: "Looking to move in mid-August, quiet professional.",
      screening: { create: { status: "pending" } },
    },
  });

  // Maintenance request on Apt 1A + a work order assigned to a vendor — vendor slice.
  const vendor = await db.vendor.create({
    data: {
      organizationId: org.id,
      name: "Maple Plumbing Co.",
      trade: "plumbing",
      phone: "+15035550100",
    },
  });
  const request = await db.maintenanceRequest.create({
    data: {
      organizationId: org.id,
      unitId: apt1a.id,
      reportedByUserId: tenant1.id,
      title: "Leaking kitchen faucet",
      description: "Steady drip under the sink cabinet.",
      priority: "high",
      status: "assigned",
    },
  });
  await db.workOrder.create({
    data: {
      maintenanceRequestId: request.id,
      vendorId: vendor.id,
      status: "scheduled",
      scheduledAt: new Date("2026-07-20"),
      notes: "Bring replacement cartridge.",
    },
  });

  // Tenant home-page announcements: one platform-wide "system" notice (null org,
  // admin-authored) + one org-scoped "landlord" notice for Maple. Both published.
  await db.announcement.createMany({
    data: [
      {
        organizationId: null,
        title: "Welcome to the new tenant portal",
        body: "You can now view your leases, bills and maintenance requests in one place.",
        publishedAt: new Date("2026-07-15"),
      },
      {
        organizationId: org.id,
        title: "Maple Court: lobby repainting next week",
        body: "Expect minor noise Mon–Wed, 9am–4pm. Thanks for your patience.",
        publishedAt: new Date("2026-07-21"),
      },
    ],
  });

  console.log(
    "Seeded: orgs=maple,cedar  users=landlord/agent/admin/vendor/tenant1/tenant2  (pwd 12345678)",
  );
  console.log(
    "  listing=published(Apt 1B)  application=submitted(tenant2)  workOrder=scheduled(vendor)",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
