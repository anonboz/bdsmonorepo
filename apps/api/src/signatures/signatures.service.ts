import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, type Signature, type SignatureRole as SignatureRoleType } from '@repo/shared';

import { type CreateSignatureDto } from './dto/signatures.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

/**
 * Phase 12.3 — captured-signature service for in-platform lease
 * acknowledgement. Both the owner and the tenant of a lease in
 * `AWAITING_SIGNATURES` POST one `Signature` row each; the second
 * insert auto-flips the lease to `ACTIVE` (and the unit to
 * `OCCUPIED`) atomically with the signature write.
 *
 * Authorization splits by role:
 * - Tenant endpoint requires `actor.id === lease.tenantId`.
 * - Owner endpoint requires `actor.id === house.ownerId` (mirror of
 *   the existing leases-service ownership guards — repeated here so
 *   the signatures module stays self-contained).
 */
@Injectable()
export class SignaturesService {
  private readonly logger = new Logger(SignaturesService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  /** Tenant-side capture. POST /v1/me/leases/:id/signatures. */
  async createForTenant(
    actor: { id: string },
    leaseId: string,
    input: CreateSignatureDto,
    ctx: RequestContext,
  ): Promise<Signature> {
    const lease = await this.findLeaseForSigner(leaseId);
    if (lease.tenantId !== actor.id) throw this.leaseNotFound();
    return this.upsertSignature(lease, 'TENANT', actor.id, input, ctx);
  }

  /** Owner-side capture. POST /v1/houses/:h/units/:u/leases/:id/signatures. */
  async createForOwner(
    actor: { id: string },
    houseId: string,
    unitId: string,
    leaseId: string,
    input: CreateSignatureDto,
    ctx: RequestContext,
  ): Promise<Signature> {
    const lease = await this.findLeaseForSigner(leaseId);
    if (lease.ownerId !== actor.id || lease.unitId !== unitId || lease.unit.houseId !== houseId) {
      throw this.leaseNotFound();
    }
    return this.upsertSignature(lease, 'OWNER', actor.id, input, ctx);
  }

  /**
   * Pure helper: upserts the signature, then — if both roles have now
   * signed — flips the lease to `ACTIVE` + unit to `OCCUPIED` inside
   * the same transaction. Writes one audit row per signature plus a
   * `lease.activate` audit row on the auto-flip.
   *
   * Re-signing the same role is allowed (the unique constraint
   * `(leaseId, role)` is the source of idempotency); the upsert
   * replaces the image + bumps `signedAt`.
   */
  private async upsertSignature(
    lease: LeaseForSigner,
    role: SignatureRoleType,
    signerId: string,
    input: CreateSignatureDto,
    ctx: RequestContext,
  ): Promise<Signature> {
    if (lease.status !== 'AWAITING_SIGNATURES') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.SIGNATURE_LEASE_NOT_AWAITING,
        title: 'Lease is not awaiting signatures',
        detail: `Cannot sign a lease in ${lease.status} state.`,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.signature.upsert({
        where: { leaseId_role: { leaseId: lease.id, role } },
        create: {
          leaseId: lease.id,
          signerId,
          role,
          imageDataUri: input.imageDataUri,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        update: {
          signerId,
          imageDataUri: input.imageDataUri,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
          signedAt: new Date(),
        },
      });

      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'signature.captured',
        target: `Lease:${lease.id}`,
        meta: {
          role,
          signatureId: row.id,
          byteSize: input.imageDataUri.length,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      // If both roles have now signed, auto-activate. Count via a
      // signature aggregate to handle the case where a re-sign of the
      // same role happens — `count` still reads 1 in that branch.
      const count = await tx.signature.count({ where: { leaseId: lease.id } });
      if (count >= 2) {
        // Defensive: re-check the active-on-unit conflict that
        // `LeasesService.transition` performs on DRAFT →
        // AWAITING_SIGNATURES, in case another lease activated in
        // the meantime.
        const conflicting = await tx.lease.count({
          where: {
            unitId: lease.unitId,
            status: 'ACTIVE',
            deletedAt: null,
            NOT: { id: lease.id },
          },
        });
        if (conflicting > 0) {
          // Don't roll the signature back — it's been captured. Just
          // skip the auto-activate and audit the conflict so ops can
          // sort it out. The owner can resolve the other lease and
          // re-submit the second signature to trigger the auto-flip.
          await this.audit.write(tx, {
            actorId: ctx.actorId,
            action: 'lease.activate.conflict',
            target: `Lease:${lease.id}`,
            meta: { reason: 'unit_has_other_active_lease', unitId: lease.unitId },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        } else {
          await tx.lease.update({
            where: { id: lease.id },
            data: { status: 'ACTIVE' },
          });
          await tx.unit.update({
            where: { id: lease.unitId },
            data: { status: 'OCCUPIED' },
          });
          await this.audit.write(tx, {
            actorId: ctx.actorId,
            action: 'lease.activate',
            target: `Lease:${lease.id}`,
            meta: { via: 'signatures', previousStatus: 'AWAITING_SIGNATURES' },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
        }
      }

      return toResponse(row);
    });
  }

  /** Tenant-side list. GET /v1/me/leases/:id/signatures. */
  async listForTenant(actor: { id: string }, leaseId: string): Promise<Signature[]> {
    const lease = await this.findLeaseForSigner(leaseId);
    if (lease.tenantId !== actor.id) throw this.leaseNotFound();
    return this.listInternal(leaseId);
  }

  /** Owner-side list. GET /v1/houses/:h/units/:u/leases/:id/signatures. */
  async listForOwner(
    actor: { id: string },
    houseId: string,
    unitId: string,
    leaseId: string,
  ): Promise<Signature[]> {
    const lease = await this.findLeaseForSigner(leaseId);
    if (lease.ownerId !== actor.id || lease.unitId !== unitId || lease.unit.houseId !== houseId) {
      throw this.leaseNotFound();
    }
    return this.listInternal(leaseId);
  }

  private async listInternal(leaseId: string): Promise<Signature[]> {
    const rows = await this.prisma.signature.findMany({
      where: { leaseId },
      orderBy: { signedAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  // ---- private --------------------------------------------------

  private async findLeaseForSigner(leaseId: string): Promise<LeaseForSigner> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        id: true,
        unitId: true,
        ownerId: true,
        tenantId: true,
        status: true,
        deletedAt: true,
        unit: { select: { houseId: true, deletedAt: true } },
      },
    });
    if (!lease || lease.deletedAt || lease.unit.deletedAt) throw this.leaseNotFound();
    return lease;
  }

  private leaseNotFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.LEASE_NOT_FOUND,
      title: 'Lease not found',
    });
  }
}

type LeaseForSigner = Prisma.LeaseGetPayload<{
  select: {
    id: true;
    unitId: true;
    ownerId: true;
    tenantId: true;
    status: true;
    deletedAt: true;
    unit: { select: { houseId: true; deletedAt: true } };
  };
}>;

type SignatureRow = Prisma.SignatureGetPayload<Record<string, never>>;

function toResponse(row: SignatureRow): Signature {
  return {
    id: row.id,
    leaseId: row.leaseId,
    signerId: row.signerId,
    role: row.role,
    imageDataUri: row.imageDataUri,
    ip: row.ip,
    userAgent: row.userAgent,
    signedAt: row.signedAt.toISOString(),
  };
}
