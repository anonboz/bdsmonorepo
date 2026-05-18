import { z } from 'zod';

export const Role = {
  ADMIN: 'ADMIN',
  OWNER: 'OWNER',
  TENANT: 'TENANT',
  PARTNER: 'PARTNER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const roleSchema = z.nativeEnum(Role);

export const ALL_ROLES = Object.values(Role) as readonly Role[];
