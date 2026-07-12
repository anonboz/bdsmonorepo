// House-renting monorepo — packages/db/src/index.ts
//
// The single server-only entry point for @repo/db: a pooled PrismaClient (pg
// driver adapter) plus explicit re-exports of the generated enums + model types
// so every app imports them from one place. Consumers on the client import
// TYPES ONLY (`import type { Lease } from "@repo/db"`).

// Server-only guard: this module opens a pg.Pool + PrismaClient at import time.
// Importing it from a client bundle (even transitively) drags the Postgres
// driver into the browser and blows up at hydration. Fail loudly at load.
if (typeof window !== "undefined") {
  throw new Error(
    "[@repo/db] Cannot be imported from a client context. This package " +
      "initializes Prisma + pg.Pool and is server-only. Use `import type` " +
      "for enum/model types, or move the calling code to a server component " +
      "or route handler.",
  );
}

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pg = require("pg") as typeof import("pg");

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: InstanceType<typeof import("pg").Pool> | undefined;
};

// Reuse a single pg.Pool across hot reloads to prevent connection leaks.
// PrismaPg built from a connectionString creates a NEW pool on every connect(),
// which leaks until the Postgres/Supabase connection limit is hit. Keep `max`
// small — each of the N apps holds its own pool.
const pool =
  globalForPrisma.pgPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 3,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.pgPool = pool;

const adapter = new PrismaPg(pool);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// ── Client + namespace ───────────────────────────────────────────────────────
export { PrismaClient, Prisma } from "@prisma/client";

// ── Enums (value exports) ────────────────────────────────────────────────────
// Adding a new enum to schema.prisma? Add it here too, or `@repo/db` consumers
// get "no exported member" at tsc time.
export {
  OrgRole,
  PropertyType,
  UnitStatus,
  ListingStatus,
  ApplicationStatus,
  ScreeningStatus,
  LeaseStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  DepositStatus,
  MaintenancePriority,
  MaintenanceStatus,
  WorkOrderStatus,
  InspectionType,
  DocumentType,
  FeatureFlagMode,
} from "@prisma/client";

// ── Model types (type-only exports) ──────────────────────────────────────────
export type {
  User,
  Organization,
  OrgMembership,
  Property,
  Unit,
  Listing,
  Application,
  Screening,
  Lease,
  Tenancy,
  RentInvoice,
  Payment,
  Deposit,
  Vendor,
  MaintenanceRequest,
  WorkOrder,
  Inspection,
  Document,
  Notification,
  FeatureFlag,
  AuditLog,
} from "@prisma/client";
