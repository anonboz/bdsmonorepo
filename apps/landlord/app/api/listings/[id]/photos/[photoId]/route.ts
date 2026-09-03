// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { deleteListingPhoto } from "@/lib/storage";
import { removeListingPhoto } from "@/services/listing.service";

export const dynamic = "force-dynamic";

/** DELETE /api/listings/:id/photos/:photoId — remove a photo (owner/landlord/agent). */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { photoId } = await params;

    const { url } = await removeListingPhoto(session, photoId);
    await deleteListingPhoto(url);
    return apiSuccess({ id: photoId });
  } catch (err) {
    return handleRouteError(err, "Failed to delete photo");
  }
}
