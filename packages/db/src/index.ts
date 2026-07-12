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
// Build the pg pool config from DATABASE_URL. Two adjustments for managed
// Postgres (Supabase): (1) node-pg v8.13+ upgrades `sslmode=require` to
// verify-full and rejects the self-signed chain, so we strip it and set ssl
// explicitly; (2) scope every query to a dedicated schema via search_path when
// DB_SCHEMA is set, keeping this stack's tables isolated in the database.
function buildPoolConfig() {
  const url = new URL(process.env.DATABASE_URL!);
  const sslmode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("schema"); // Prisma-only param; pg doesn't understand it
  return {
    connectionString: url.toString(),
    max: 3,
    idleTimeoutMillis: 30_000,
    ...(sslmode ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

const dbSchema = process.env.DB_SCHEMA;

const pool = globalForPrisma.pgPool ?? new pg.Pool(buildPoolConfig());

// Scope every query to a dedicated schema. Startup `options=-c search_path`
// gets swallowed by connection poolers (Supabase Supavisor), so run an explicit
// `SET search_path` on each new physical connection instead — session poolers
// preserve it for the life of the connection.
if (dbSchema && !globalForPrisma.pgPool) {
  pool.on("connect", (client) => {
    client.query(`set search_path to "${dbSchema}", public`).catch(() => {});
  });
}

if (process.env.NODE_ENV !== "production") globalForPrisma.pgPool = pool;

const adapter = new PrismaPg(pool);

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
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
