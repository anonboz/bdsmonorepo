import {
  type notificationSchema,
  listNotificationsQuerySchema,
  upsertNotificationPreferenceSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const ListNotificationsQueryDto = createZodDto(listNotificationsQuerySchema);
export type ListNotificationsQueryDto = typeof listNotificationsQuerySchema._type;

export const UpsertNotificationPreferenceDto = createZodDto(upsertNotificationPreferenceSchema);
export type UpsertNotificationPreferenceDto = typeof upsertNotificationPreferenceSchema._type;

export type NotificationResponse = typeof notificationSchema._type;
