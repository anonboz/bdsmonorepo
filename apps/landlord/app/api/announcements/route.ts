// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createOrgAnnouncement, listOrgAnnouncements } from "@/services/announcement.service";

export const dynamic = "force-dynamic";

/** GET /api/announcements — this org's announcements (drafts included). */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listOrgAnnouncements(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list announcements");
  }
}

/** POST /api/announcements — create an announcement for this org (owner/landlord). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const body = await req.json();
    const created = await createOrgAnnouncement(session, body);
    return apiSuccess(created, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to create announcement");
  }
}
