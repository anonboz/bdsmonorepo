import { z } from 'zod';

export const UnitStatus = {
  VACANT: 'VACANT',
  OCCUPIED: 'OCCUPIED',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];
export const unitStatusSchema = z.nativeEnum(UnitStatus);

export const LeaseStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
  TERMINATED: 'TERMINATED',
} as const;
export type LeaseStatus = (typeof LeaseStatus)[keyof typeof LeaseStatus];
export const leaseStatusSchema = z.nativeEnum(LeaseStatus);

export const RentCycle = {
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
} as const;
export type RentCycle = (typeof RentCycle)[keyof typeof RentCycle];
export const rentCycleSchema = z.nativeEnum(RentCycle);

export const PaymentStatus = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const paymentStatusSchema = z.nativeEnum(PaymentStatus);

export const PaymentProvider = {
  STRIPE: 'STRIPE',
  VNPAY: 'VNPAY',
  MOMO: 'MOMO',
  MANUAL: 'MANUAL',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];
export const paymentProviderSchema = z.nativeEnum(PaymentProvider);

export const CampaignStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  LIVE: 'LIVE',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];
export const campaignStatusSchema = z.nativeEnum(CampaignStatus);

export const ApplicationStatus = {
  SUBMITTED: 'SUBMITTED',
  REVIEWING: 'REVIEWING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];
export const applicationStatusSchema = z.nativeEnum(ApplicationStatus);

export const KycStatus = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type KycStatus = (typeof KycStatus)[keyof typeof KycStatus];
export const kycStatusSchema = z.nativeEnum(KycStatus);

export const NotificationChannel = {
  IN_APP: 'IN_APP',
  EMAIL: 'EMAIL',
  PUSH: 'PUSH',
  SMS: 'SMS',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];
export const notificationChannelSchema = z.nativeEnum(NotificationChannel);

export const RatingMilestone = {
  MOVE_IN: 'MOVE_IN',
  MID_LEASE: 'MID_LEASE',
  MOVE_OUT: 'MOVE_OUT',
} as const;
export type RatingMilestone = (typeof RatingMilestone)[keyof typeof RatingMilestone];
export const ratingMilestoneSchema = z.nativeEnum(RatingMilestone);

export const RatingDirection = {
  TENANT_TO_OWNER: 'TENANT_TO_OWNER',
  OWNER_TO_TENANT: 'OWNER_TO_TENANT',
} as const;
export type RatingDirection = (typeof RatingDirection)[keyof typeof RatingDirection];
export const ratingDirectionSchema = z.nativeEnum(RatingDirection);

export const BillLineKind = {
  RENT: 'RENT',
  DEPOSIT: 'DEPOSIT',
  UTILITY_ELECTRICITY: 'UTILITY_ELECTRICITY',
  UTILITY_WATER: 'UTILITY_WATER',
  UTILITY_INTERNET: 'UTILITY_INTERNET',
  UTILITY_OTHER: 'UTILITY_OTHER',
  SERVICE_FEE: 'SERVICE_FEE',
  LATE_FEE: 'LATE_FEE',
  ADJUSTMENT: 'ADJUSTMENT',
  OTHER: 'OTHER',
} as const;
export type BillLineKind = (typeof BillLineKind)[keyof typeof BillLineKind];
export const billLineKindSchema = z.nativeEnum(BillLineKind);
