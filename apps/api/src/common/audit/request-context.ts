import type { FastifyRequest } from 'fastify';

import type { AuthenticatedUser } from '../../auth/auth.types.js';

/**
 * Per-request audit context. Passed from controllers into services so
 * the same `AuditLog` write can record *who* + *from where* alongside
 * the change it audits.
 *
 * `actorId` is the authenticated user's id, or `null` when the action
 * was system-initiated (e.g. the BullMQ sweeper generating a bill).
 */
export interface RequestContext {
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Build a `RequestContext` from the controller's CurrentUser + Fastify req. */
export function requestContextFrom(user: AuthenticatedUser, req: FastifyRequest): RequestContext {
  return {
    actorId: user.id,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/** Context for system-initiated audit writes (workers, cron). */
export function systemContext(extras: Partial<RequestContext> = {}): RequestContext {
  return { actorId: null, ip: null, userAgent: null, ...extras };
}
