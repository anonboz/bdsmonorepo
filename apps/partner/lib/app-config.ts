import type { Role } from '@repo/shared';

export const APP_ROLE: Role = 'PARTNER';
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? 'BDS Partner';
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';

export const POST_LOGIN_PATH = '/';

/**
 * Phase 12.6 — gates the phone + password login UI (and the set-password
 * nudge) so the client can ship dark and flip on per-app once the backend
 * is live. Off unless `NEXT_PUBLIC_AUTH_PASSWORD_ENABLED=true`.
 */
export const AUTH_PASSWORD_ENABLED = process.env.NEXT_PUBLIC_AUTH_PASSWORD_ENABLED === 'true';
