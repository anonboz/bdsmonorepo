// THIN route handler: resolve session → gate role → upload to storage → save
// the row → shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { uploadInspectionPhoto } from "@/lib/storage";
import { addInspectionPhoto } from "@/services/inspection.service";

export const dynamic = "force-dynamic";

/** POST /api/inspections/:id/photos — upload + attach a photo (owner/landlord/agent). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("INVALID_INPUT");

    const url = await uploadInspectionPhoto(session.organizationId, id, file);
    const photo = await addInspectionPhoto(session, id, { url });
    return apiSuccess(photo, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to upload photo");
  }
}
