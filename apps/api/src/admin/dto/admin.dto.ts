import {
  type auditLogEntrySchema,
  kycDecisionSchema,
  listAdminUsersQuerySchema,
  listAuditLogQuerySchema,
  suspendUserSchema,
  unsuspendUserSchema,
  type adminUserSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListAdminUsersQueryDto = createZodDto(listAdminUsersQuerySchema);
export type ListAdminUsersQueryDto = typeof listAdminUsersQuerySchema._type;

export const SuspendUserDto = createZodDto(suspendUserSchema);
export type SuspendUserDto = typeof suspendUserSchema._type;

export const UnsuspendUserDto = createZodDto(unsuspendUserSchema);
export type UnsuspendUserDto = typeof unsuspendUserSchema._type;

export const KycDecisionDto = createZodDto(kycDecisionSchema);
export type KycDecisionDto = typeof kycDecisionSchema._type;

export const ListAuditLogQueryDto = createZodDto(listAuditLogQuerySchema);
export type ListAuditLogQueryDto = typeof listAuditLogQuerySchema._type;

export type AdminUserResponse = typeof adminUserSchema._type;
export type AuditLogEntryResponse = typeof auditLogEntrySchema._type;
