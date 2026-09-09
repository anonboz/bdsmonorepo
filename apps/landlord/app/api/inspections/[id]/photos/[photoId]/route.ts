// THIN route handler: resolve session → gate role → call service → clear
// storage → shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { deleteInspectionPhoto } from "@/lib/storage";
import { removeInspectionPhoto } from "@/services/inspection.service";

export const dynamic = "force-dynamic";

/** DELETE /api/inspections/:id/photos/:photoId — remove a photo (owner/landlord/agent). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { photoId } = await params;

    const { url } = await removeInspectionPhoto(session, photoId);
    await deleteInspectionPhoto(url);
    return apiSuccess({ id: photoId });
  } catch (err) {
    return handleRouteError(err, "Failed to delete photo");
  }
}
