import type { Role } from '@repo/shared';

export const APP_ROLE: Role = 'TENANT';
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'BDS Tenant';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export const POST_LOGIN_PATH = '/';
