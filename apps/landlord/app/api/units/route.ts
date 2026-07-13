// THIN route handler: resolve session → gate role → call service → shape
// response. The parent propertyId is in the body; the service asserts the
// property belongs to the caller's org before creating the unit.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createUnit } from "@/services/property.service";

export const dynamic = "force-dynamic";

/** POST /api/units — add a unit to an org-owned property (owner/landlord only). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const body = await req.json();
    const unit = await createUnit(session, body);
    return apiSuccess(unit, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to create unit");
  }
}
