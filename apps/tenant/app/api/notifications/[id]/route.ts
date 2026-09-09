// THIN route handler: resolve session → call service → shape response. Body
// validation (Zod) happens in the service, like every other boundary.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { markNotificationRead } from "@/services/notification.service";

export const dynamic = "force-dynamic";

/** PATCH /api/notifications/:id  body { read: true } — mark one notification read. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    // An empty body is a validation error (400), not a server error (500).
    const raw: unknown = await req.json().catch(() => ({}));
    const data = await markNotificationRead(session, id, raw);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to mark notification read");
  }
}
