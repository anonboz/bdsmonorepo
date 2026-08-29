// THIN route handler: resolve session → gate admin role → call service → shape
// response. No business logic, no Prisma here. Admin is global — no org scope.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireAdmin } from "@/lib/session";
import {
  deleteSystemAnnouncement,
  setSystemAnnouncementPublished,
} from "@/services/announcement.service";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/announcements/:id — publish or unpublish an announcement. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireAdmin(session);
    const { id } = await params;
    const body = await req.json();
    const updated = await setSystemAnnouncementPublished(session, id, body);
    return apiSuccess(updated);
  } catch (err) {
    return handleRouteError(err, "Failed to update announcement");
  }
}

/** DELETE /api/admin/announcements/:id — remove an announcement. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireAdmin(session);
    const { id } = await params;
    const data = await deleteSystemAnnouncement(session, id);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to delete announcement");
  }
}
