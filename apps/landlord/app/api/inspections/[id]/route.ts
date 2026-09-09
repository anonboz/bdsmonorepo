// THIN route handler: resolve session → gate role → call service → clear
// storage → shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { deleteInspectionPhoto } from "@/lib/storage";
import { deleteInspection, updateInspectionNotes } from "@/services/inspection.service";

export const dynamic = "force-dynamic";

/** PATCH /api/inspections/:id  { notes } — update the notes (owner/landlord/agent). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const data = await updateInspectionNotes(session, id, body);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to update inspection");
  }
}

/** DELETE /api/inspections/:id — remove the record and all its photos (owner/landlord/agent). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const { photoUrls } = await deleteInspection(session, id);
    await Promise.all(photoUrls.map(deleteInspectionPhoto));
    return apiSuccess({ id });
  } catch (err) {
    return handleRouteError(err, "Failed to delete inspection");
  }
}
