// THIN route handler: resolve session → gate role → call the storage helper →
// shape response. No business logic, no Prisma here. The service-role Supabase
// client stays server-side in @/lib/storage — never sent to the browser.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { uploadMeterReadingPhoto } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** POST /api/meter-readings/upload — upload a meter photo (owner/landlord/agent). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");

    const form = await req.formData();
    const file = form.get("file");
    const unitId = form.get("unitId");
    if (!(file instanceof File) || typeof unitId !== "string" || unitId === "") {
      throw new Error("INVALID_INPUT");
    }

    const url = await uploadMeterReadingPhoto(session.organizationId, unitId, file);
    return apiSuccess({ url }, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to upload photo");
  }
}
