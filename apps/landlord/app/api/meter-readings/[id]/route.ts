// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { deleteMeterReadingPhoto } from "@/lib/storage";
import { getSession, requireRole } from "@/lib/session";
import { deleteMeterReading, updateMeterReading } from "@/services/meter-reading.service";

export const dynamic = "force-dynamic";

/** PATCH /api/meter-readings/:id — edit an unbilled reading (owner/landlord/agent). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const body = await req.json();
    const { photoUrlToDelete } = await updateMeterReading(session, id, body);
    if (photoUrlToDelete) await deleteMeterReadingPhoto(photoUrlToDelete);
    return apiSuccess({ id });
  } catch (err) {
    return handleRouteError(err, "Failed to update meter reading");
  }
}

/** DELETE /api/meter-readings/:id — remove an unbilled reading (owner/landlord/agent). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const { photoUrl } = await deleteMeterReading(session, id);
    if (photoUrl) await deleteMeterReadingPhoto(photoUrl);
    return apiSuccess({ id });
  } catch (err) {
    return handleRouteError(err, "Failed to delete meter reading");
  }
}
