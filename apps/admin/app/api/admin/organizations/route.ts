// THIN route handler: resolve session → gate admin role → call service → shape
// response. No business logic, no Prisma here. Admin is global — no org scope.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireAdmin } from "@/lib/session";
import { listOrganizations } from "@/services/admin.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/organizations?active=true&take=20&skip=0 — every org, global. */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    requireAdmin(session);
    const url = new URL(req.url);
    const data = await listOrganizations(session, {
      active: url.searchParams.get("active") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list organizations");
  }
}
