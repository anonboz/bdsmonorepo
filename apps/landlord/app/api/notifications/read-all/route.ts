// THIN route handler: resolve session → call service → shape response.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { markAllNotificationsRead } from "@/services/notification.service";

export const dynamic = "force-dynamic";

/** POST /api/notifications/read-all — mark every unread notification read. */
export async function POST() {
  try {
    const session = await getSession();
    const data = await markAllNotificationsRead(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to mark notifications read");
  }
}
