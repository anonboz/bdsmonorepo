// THIN route handler: resolve session → call service → shape response.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { listMyNotifications } from "@/services/notification.service";

export const dynamic = "force-dynamic";

/** GET /api/notifications — the signed-in user's inbox, newest first, plus unread count. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listMyNotifications(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list notifications");
  }
}
