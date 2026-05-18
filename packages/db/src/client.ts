import { PrismaClient } from '@prisma/client';

/**
 * Single PrismaClient instance per process. In dev with HMR, attach to globalThis
 * so we don't leak connections on hot reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** The single PrismaClient instance type. Named `Db` to avoid shadowing the
 *  `Prisma` namespace from @prisma/client (used for `Prisma.HouseGetPayload`,
 *  `Prisma.validator()`, etc.). */
export type Db = typeof prisma;
