// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { deleteListingPhoto } from "@/lib/storage";
import { deleteListing, updateListing } from "@/services/listing.service";

export const dynamic = "force-dynamic";

/** PATCH /api/listings/:id — edit fields and/or status (owner/landlord/agent). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const body = await req.json();
    const listing = await updateListing(session, id, body);
    return apiSuccess(listing);
  } catch (err) {
    return handleRouteError(err, "Failed to update listing");
  }
}

/** DELETE /api/listings/:id — remove a listing and its photos (owner/landlord/agent). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const { photoUrls } = await deleteListing(session, id);
    await Promise.all(photoUrls.map((url) => deleteListingPhoto(url)));
    return apiSuccess({ id });
  } catch (err) {
    return handleRouteError(err, "Failed to delete listing");
  }
}
