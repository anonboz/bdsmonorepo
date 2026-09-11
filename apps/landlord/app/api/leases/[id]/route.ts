// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { setLeaseStatus } from "@/services/lease.service";

export const dynamic = "force-dynamic";

/** PATCH /api/leases/:id — change lease status (owner/landlord/agent). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const body = await req.json();
    const lease = await setLeaseStatus(session, id, body);
    return apiSuccess(lease);
  } catch (err) {
    return handleRouteError(err, "Failed to update lease");
  }
}
