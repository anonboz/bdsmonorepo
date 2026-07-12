// House-renting monorepo — packages/db/prisma.config.ts
//
// Prisma 7 moved connection config out of schema.prisma into this file. Only the
// CLI (migrate / db pull / studio) reads it — the runtime PrismaClient connects
// via the pg driver adapter in src/index.ts (DATABASE_URL, pooled).
//
// DIRECT_URL must be a NON-pooled connection: migrations need DDL locks + a
// shadow DB, which a pgbouncer/transaction-pooled URL (Supabase :6543) can't do.
// Point DIRECT_URL at the direct :5432 connection; keep DATABASE_URL pooled.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL!,
  },
});
