import type { Role } from '@repo/shared';

export const APP_ROLE: Role = 'ADMIN';
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'BDS Admin';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Where to send the user after a successful login. */
export const POST_LOGIN_PATH = '/';
