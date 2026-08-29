// THIN route handler: resolve session → gate admin role → call service → shape
// response. No business logic, no Prisma here. Admin is global — no org scope.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireAdmin } from "@/lib/session";
import { createSystemAnnouncement, listSystemAnnouncements } from "@/services/announcement.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/announcements — all platform-wide announcements (drafts too). */
export async function GET() {
  try {
    const session = await getSession();
    requireAdmin(session);
    const data = await listSystemAnnouncements(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list announcements");
  }
}

/** POST /api/admin/announcements — create a platform-wide announcement. */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireAdmin(session);
    const body = await req.json();
    const created = await createSystemAnnouncement(session, body);
    return apiSuccess(created, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to create announcement");
  }
}
