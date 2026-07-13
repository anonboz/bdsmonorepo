// Idempotent seed for the live smoke test. Clears all tables (public schema) then
// inserts one primary org (Maple) with a full cast + data for every app's slice,
// plus a second org (Cedar) so the admin console has more than one row.
//
// All logins use password: Passw0rd!23
//   landlord@example.com (landlord) · agent@example.com (agent)
//   admin@example.com (admin) · vendor@example.com (vendor)
//   tenant1@example.com / tenant2@example.com (tenants)

import "dotenv/config";
import { db } from "../src/index";
import bcrypt from "bcryptjs";

async function reset() {
  // Delete children before parents (FK order).
  await db.payment.deleteMany();
  await db.rentInvoice.deleteMany();
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
  const passwordHash = await bcrypt.hash("Passw0rd!23", 10);
  const user = (email: string, name: string) =>
    db.user.create({ data: { email, name, passwordHash } });

  const org = await db.organization.create({
    data: { name: "Maple Property Group", slug: "maple" },
  });
  const cedar = await db.organization.create({ data: { name: "Cedar Rentals", slug: "cedar" } });

  // Staff (org members) + tenants (no membership — they relate via Tenancy).
  const landlord = await user("landlord@example.com", "Otto Landlord");
  const agent = await user("agent@example.com", "Ava Agent");
  const admin = await user("admin@example.com", "Sam Admin");
  const vendorUser = await user("vendor@example.com", "Vince Vendor");
  const tenant1 = await user("tenant1@example.com", "Tara Tenant");
  const tenant2 = await user("tenant2@example.com", "Theo Tenant");

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
  await db.lease.create({
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

  console.log(
    "Seeded: orgs=maple,cedar  users=landlord/agent/admin/vendor/tenant1/tenant2  (pwd Passw0rd!23)",
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
