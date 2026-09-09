// THIN route handler. Polled by the bell in the app shell, so keep it cheap.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getUnreadCount } from "@/services/notification.service";

export const dynamic = "force-dynamic";

/** GET /api/notifications/unread-count — { unread: number }. */
export async function GET() {
  try {
    const session = await getSession();
    const unread = await getUnreadCount(session);
    return apiSuccess({ unread });
  } catch (err) {
    return handleRouteError(err, "Failed to count notifications");
  }
}
