// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { listUtilityRates, upsertUtilityRate } from "@/services/utility-rate.service";

export const dynamic = "force-dynamic";

/** GET /api/utility-rates — this org's utility rates + the admin min/max bounds. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listUtilityRates(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list utility rates");
  }
}

/** PUT /api/utility-rates — set a utility's price per unit (owner/landlord only). */
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const body = await req.json();
    const rate = await upsertUtilityRate(session, body);
    return apiSuccess(rate);
  } catch (err) {
    return handleRouteError(err, "Failed to save utility rate");
  }
}
