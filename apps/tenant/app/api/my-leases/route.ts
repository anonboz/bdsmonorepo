// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { listMyLeases } from "@/services/lease.service";

export const dynamic = "force-dynamic";

/** GET /api/my-leases — leases this tenant is on, across all orgs. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listMyLeases(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list leases");
  }
}
