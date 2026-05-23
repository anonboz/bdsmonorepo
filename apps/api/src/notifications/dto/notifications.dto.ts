import {
  type notificationSchema,
  listNotificationsQuerySchema,
  notificationQuietHoursSchema,
  upsertNotificationPreferenceSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListNotificationsQueryDto = createZodDto(listNotificationsQuerySchema);
export type ListNotificationsQueryDto = typeof listNotificationsQuerySchema._type;

export const UpsertNotificationPreferenceDto = createZodDto(upsertNotificationPreferenceSchema);
export type UpsertNotificationPreferenceDto = typeof upsertNotificationPreferenceSchema._type;

export const UpsertQuietHoursDto = createZodDto(notificationQuietHoursSchema);
export type UpsertQuietHoursDto = typeof notificationQuietHoursSchema._type;

export type NotificationResponse = typeof notificationSchema._type;
