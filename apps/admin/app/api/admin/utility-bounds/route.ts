// THIN route handler: resolve session → gate admin role → call service → shape
// response. No business logic, no Prisma here. Admin is global — no org scope.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireAdmin } from "@/lib/session";
import { listUtilityBounds, upsertUtilityBound } from "@/services/utility-bound.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/utility-bounds — platform min/max bounds per metered utility. */
export async function GET() {
  try {
    const session = await getSession();
    requireAdmin(session);
    const data = await listUtilityBounds(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list utility bounds");
  }
}

/** PUT /api/admin/utility-bounds — set a utility's min/max price bound. */
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    requireAdmin(session);
    const body = await req.json();
    const bound = await upsertUtilityBound(session, body);
    return apiSuccess(bound);
  } catch (err) {
    return handleRouteError(err, "Failed to save utility bound");
  }
}
