import type { Db } from '@repo/db';

export const PRISMA = Symbol.for('@repo/api:prisma');
export type PrismaInstance = Db;
