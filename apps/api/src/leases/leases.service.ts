import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, type Lease, type LeaseStatus, type Page, type Role } from '@repo/shared';

import type {
  CreateLeaseDto,
  ListLeasesQueryDto,
  TransitionLeaseDto,
  UpdateLeaseDto,
} from './dto/leases.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

type LeaseRow = Prisma.LeaseGetPayload<{ include: { unit: { select: { houseId: true } } } }>;

const LEASE_WITH_UNIT = {
  include: { unit: { select: { houseId: true } } },
} satisfies Prisma.LeaseDefaultArgs;

/**
 * Allowed state transitions for a lease. Source of truth — both the service
 * and any future API surface should reference this rather than reimplementing.
 *
 * Phase 12.3 — `DRAFT → ACTIVE` was removed. Owners now move
 * `DRAFT → AWAITING_SIGNATURES`; both parties sign; the signatures
 * service auto-flips `AWAITING_SIGNATURES → ACTIVE` when both Signature
 * rows land. `AWAITING_SIGNATURES → DRAFT` is allowed for re-editing
 * (cascades any captured signatures via the schema).
 */
const ALLOWED_TRANSITIONS: Record<LeaseStatus, LeaseStatus[]> = {
  DRAFT: ['AWAITING_SIGNATURES', 'TERMINATED'],
  AWAITING_SIGNATURES: ['DRAFT', 'TERMINATED'],
  ACTIVE: ['ENDED', 'TERMINATED'],
  ENDED: [],
  TERMINATED: [],
};

/** Audit action code per terminal status reachable via the manual API. */
const ACTION_FOR_TRANSITION: Record<
  'AWAITING_SIGNATURES' | 'DRAFT' | 'ENDED' | 'TERMINATED',
  string
> = {
  AWAITING_SIGNATURES: 'lease.send_for_signatures',
  DRAFT: 'lease.revert_to_draft',
  ENDED: 'lease.end',
  TERMINATED: 'lease.terminate',
};

/**
 * Leases service.
 *
 * Authorization is multi-party:
 * - **Owner** (of the parent house): full CRUD + transitions, scoped to their
 *   own units. Mutations go through `assertHouseAccess` then `findOwnedLease`.
 * - **Tenant** (named on the lease): read-only via the `/v1/me/leases*` entry
 *   points. Sees only leases where `tenantId === actor.id`.
 * - **Admin**: read-any via `/v1/leases*`. No mutations in this slice.
 *
 * Side effects: activating a lease flips its unit to OCCUPIED; ending or
 * terminating flips back to VACANT. Both happen inside the same transaction
 * as the lease update.
 */
@Injectable()
export class LeasesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  // ---- Owner-scoped (nested under unit) -----------------------------

  async createForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    input: CreateLeaseDto,
  ): Promise<Lease> {
    const { house, unit } = await this.assertOwnerOfUnit(actor, houseId, unitId);
    await this.assertTenantIsTenant(input.tenantId);

    const created = await this.prisma.lease.create({
      data: {
        unitId: unit.id,
        ownerId: house.ownerId,
        tenantId: input.tenantId,
        status: 'DRAFT',
        rentCycle: input.rentCycle,
        rentAmount: input.rentAmount,
        depositAmount: input.depositAmount,
        currency: input.currency,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
      },
      ...LEASE_WITH_UNIT,
    });
    return this.toResponse(created);
  }

  async listForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    query: ListLeasesQueryDto,
  ): Promise<Page<Lease>> {
    await this.assertOwnerOrAdminOfUnit(actor, houseId, unitId);
    return this.paginate(
      {
        unitId,
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
  ): Promise<Lease> {
    await this.assertOwnerOrAdminOfUnit(actor, houseId, unitId);
    const row = await this.findLeaseOnUnit(id, unitId);
    return this.toResponse(row);
  }

  async updateDraft(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
    patch: UpdateLeaseDto,
  ): Promise<Lease> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findLeaseOnUnit(id, unitId);

    if (existing.status !== 'DRAFT') {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.LEASE_INVALID_TRANSITION,
        title: 'Lease is locked',
        detail: `Cannot edit a lease in ${existing.status} state. Lease is locked once activated.`,
      });
    }

    if (patch.tenantId && patch.tenantId !== existing.tenantId) {
      await this.assertTenantIsTenant(patch.tenantId);
    }

    const updated = await this.prisma.lease.update({
      where: { id },
      data: {
        ...(patch.tenantId !== undefined && { tenantId: patch.tenantId }),
        ...(patch.rentAmount !== undefined && { rentAmount: patch.rentAmount }),
        ...(patch.depositAmount !== undefined && { depositAmount: patch.depositAmount }),
        ...(patch.rentCycle !== undefined && { rentCycle: patch.rentCycle }),
        ...(patch.endDate !== undefined && {
          endDate: patch.endDate ? new Date(patch.endDate) : null,
        }),
      },
      ...LEASE_WITH_UNIT,
    });
    return this.toResponse(updated);
  }

  async transition(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
    input: TransitionLeaseDto,
    ctx: RequestContext,
  ): Promise<Lease> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findLeaseOnUnit(id, unitId);

    if (!ALLOWED_TRANSITIONS[existing.status].includes(input.to)) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.LEASE_INVALID_TRANSITION,
        title: 'Invalid lease transition',
        detail: `Cannot move lease from ${existing.status} to ${input.to}.`,
      });
    }

    // Sending for signatures: refuse if another lease on the unit is
    // already ACTIVE. (We don't fight over AWAITING_SIGNATURES — the
    // auto-activate in the signatures service re-checks this conflict
    // before flipping to ACTIVE.)
    if (input.to === 'AWAITING_SIGNATURES') {
      const conflicting = await this.prisma.lease.count({
        where: { unitId, status: 'ACTIVE', deletedAt: null, NOT: { id } },
      });
      if (conflicting > 0) {
        throw new ProblemError({
          status: 409,
          type: ErrorCodes.LEASE_DATES_OVERLAP,
          title: 'Unit already has an active lease',
          detail: 'End or terminate the active lease before signing this one.',
        });
      }
    }

    // Snapshot the previous status before opening the transaction. We
    // can't read it back from inside — the mutation overwrites it.
    const previousStatus = existing.status;

    // Phase 12.3 — `transition` is now the owner-facing manual API for
    // DRAFT / AWAITING_SIGNATURES / ENDED / TERMINATED. The auto-flip
    // to ACTIVE lives in `SignaturesService.create` so that path can
    // bundle the unit-status update with the second-signature insert.
    const isManualTarget = (
      to: LeaseStatus,
    ): to is 'AWAITING_SIGNATURES' | 'DRAFT' | 'ENDED' | 'TERMINATED' =>
      to === 'AWAITING_SIGNATURES' || to === 'DRAFT' || to === 'ENDED' || to === 'TERMINATED';
    if (!isManualTarget(input.to)) {
      // Unreachable per ALLOWED_TRANSITIONS — defensive throw so a
      // schema drift doesn't silently miss the audit write.
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.LEASE_INVALID_TRANSITION,
        title: 'Invalid lease transition',
        detail: `Manual API cannot move lease to ${input.to as string}.`,
      });
    }
    const targetAction = ACTION_FOR_TRANSITION[input.to];

    // Update lease + flip unit status + audit row atomically.
    const updated = await this.prisma.$transaction(async (tx) => {
      const leaseUpdate = await tx.lease.update({
        where: { id },
        data: {
          status: input.to,
          ...(input.to === 'TERMINATED' && { terminationReason: input.terminationReason ?? null }),
          ...((input.to === 'ENDED' || input.to === 'TERMINATED') &&
            !existing.endDate && { endDate: new Date() }),
        },
        ...LEASE_WITH_UNIT,
      });

      if (input.to === 'ENDED' || input.to === 'TERMINATED') {
        // Only flip the unit back if it was occupied by THIS lease (defensive
        // — overlap guard above should make this always true).
        await tx.unit.update({ where: { id: unitId }, data: { status: 'VACANT' } });
      }

      const meta: Record<string, unknown> = { previousStatus, unitId, houseId };
      if (input.to === 'TERMINATED' && input.terminationReason) {
        meta.terminationReason = input.terminationReason;
      }
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: targetAction,
        target: `Lease:${id}`,
        meta,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return leaseUpdate;
    });

    return this.toResponse(updated);
  }

  // ---- Tenant-scoped ------------------------------------------------

  async listForTenant(tenantId: string, query: ListLeasesQueryDto): Promise<Page<Lease>> {
    return this.paginate(
      {
        tenantId,
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForTenant(tenantId: string, id: string): Promise<Lease> {
    const row = await this.prisma.lease.findUnique({ where: { id }, ...LEASE_WITH_UNIT });
    if (!row || row.deletedAt || row.tenantId !== tenantId) {
      throw this.notFound();
    }
    return this.toResponse(row);
  }

  // ---- Admin-scoped -------------------------------------------------

  async listAll(query: ListLeasesQueryDto): Promise<Page<Lease>> {
    return this.paginate(
      { deletedAt: null, ...(query.status !== undefined && { status: query.status }) },
      query,
    );
  }

  async getAny(id: string): Promise<Lease> {
    const row = await this.prisma.lease.findUnique({ where: { id }, ...LEASE_WITH_UNIT });
    if (!row || row.deletedAt) throw this.notFound();
    return this.toResponse(row);
  }

  // ---- helpers ------------------------------------------------------

  private async paginate(
    where: Prisma.LeaseWhereInput,
    query: ListLeasesQueryDto,
  ): Promise<Page<Lease>> {
    const limit = query.limit;
    const findArgs: Prisma.LeaseFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...LEASE_WITH_UNIT,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.lease.findMany(findArgs)) as LeaseRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async assertOwnerOfUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
  ): Promise<{ house: { id: string; ownerId: string }; unit: { id: string; houseId: string } }> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        houseId: true,
        deletedAt: true,
        house: { select: { id: true, ownerId: true, deletedAt: true } },
      },
    });
    if (
      !unit ||
      unit.deletedAt ||
      unit.houseId !== houseId ||
      !unit.house ||
      unit.house.deletedAt
    ) {
      throw this.notFound();
    }
    if (actor.id !== unit.house.ownerId) throw this.notFound();
    return {
      house: { id: unit.house.id, ownerId: unit.house.ownerId },
      unit: { id: unit.id, houseId: unit.houseId },
    };
  }

  private async assertOwnerOrAdminOfUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        houseId: true,
        deletedAt: true,
        house: { select: { ownerId: true, deletedAt: true } },
      },
    });
    if (
      !unit ||
      unit.deletedAt ||
      unit.houseId !== houseId ||
      !unit.house ||
      unit.house.deletedAt
    ) {
      throw this.notFound();
    }
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && actor.id !== unit.house.ownerId) throw this.notFound();
  }

  private async assertTenantIsTenant(tenantId: string): Promise<void> {
    const tenant = await this.prisma.user.findUnique({
      where: { id: tenantId },
      select: { id: true, roles: true, deletedAt: true, isSuspended: true },
    });
    if (!tenant || tenant.deletedAt || tenant.isSuspended || !tenant.roles.includes('TENANT')) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.LEASE_TENANT_INVALID,
        title: 'Tenant not eligible',
        detail: 'The selected user is not a tenant or is not active.',
      });
    }
  }

  private async findLeaseOnUnit(id: string, unitId: string): Promise<LeaseRow> {
    const row = await this.prisma.lease.findUnique({ where: { id }, ...LEASE_WITH_UNIT });
    if (!row || row.deletedAt || row.unitId !== unitId) throw this.notFound();
    return row;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.LEASE_NOT_FOUND,
      title: 'Lease not found',
    });
  }

  private toResponse(row: LeaseRow): Lease {
    return {
      id: row.id,
      unitId: row.unitId,
      houseId: row.unit.houseId,
      ownerId: row.ownerId,
      tenantId: row.tenantId,
      status: row.status,
      rentCycle: row.rentCycle,
      rentAmount: row.rentAmount,
      depositAmount: row.depositAmount,
      currency: row.currency,
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
      terminationReason: row.terminationReason ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
