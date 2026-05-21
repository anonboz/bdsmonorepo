import { vi } from 'vitest';

import type { NotificationsService } from './notifications.service.js';

/**
 * Stub NotificationsService that satisfies the constructor signature
 * of every service that dispatches notifications, without spinning up
 * a real BullMQ queue or a Notification table inside the unit-test
 * Prisma stub.
 *
 * `dispatch` returns a stable id + a no-op enqueue. `dispatchAndEnqueue`
 * returns the same id. Both are vi.fn() so individual tests can assert
 * call counts / arguments when they care; they default to permissive.
 */
export function stubNotifications(): NotificationsService {
  const dispatch = vi.fn(() =>
    Promise.resolve({
      id: 'notif_stub_1',
      enqueue: vi.fn(() => Promise.resolve()),
    }),
  );
  const dispatchAndEnqueue = vi.fn(() => Promise.resolve('notif_stub_1'));
  return { dispatch, dispatchAndEnqueue } as unknown as NotificationsService;
}
