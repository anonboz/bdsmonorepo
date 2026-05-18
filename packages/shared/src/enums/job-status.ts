import { z } from 'zod';

export const JobStatus = {
  REQUESTED: 'REQUESTED',
  QUOTED: 'QUOTED',
  ACCEPTED: 'ACCEPTED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  RATED: 'RATED',
  CANCELLED: 'CANCELLED',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const jobStatusSchema = z.nativeEnum(JobStatus);

export const JobCancellationReason = {
  OWNER_CANCELLED: 'OWNER_CANCELLED',
  PARTNER_DECLINED: 'PARTNER_DECLINED',
  PARTNER_NO_SHOW: 'PARTNER_NO_SHOW',
  PRICE_DISAGREEMENT: 'PRICE_DISAGREEMENT',
  SCHEDULING_CONFLICT: 'SCHEDULING_CONFLICT',
  OTHER: 'OTHER',
} as const;

export type JobCancellationReason =
  (typeof JobCancellationReason)[keyof typeof JobCancellationReason];

export const jobCancellationReasonSchema = z.nativeEnum(JobCancellationReason);
