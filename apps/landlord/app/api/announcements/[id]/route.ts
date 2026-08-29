// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import {
  deleteOrgAnnouncement,
  setOrgAnnouncementPublished,
} from "@/services/announcement.service";

export const dynamic = "force-dynamic";

/** PATCH /api/announcements/:id — publish or unpublish (owner/landlord). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    const body = await req.json();
    const updated = await setOrgAnnouncementPublished(session, id, body);
    return apiSuccess(updated);
  } catch (err) {
    return handleRouteError(err, "Failed to update announcement");
  }
}

/** DELETE /api/announcements/:id — remove an announcement (owner/landlord). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    const data = await deleteOrgAnnouncement(session, id);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to delete announcement");
  }
}
