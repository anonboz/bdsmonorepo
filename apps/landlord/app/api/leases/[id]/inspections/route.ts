// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createInspection, listLeaseInspections } from "@/services/inspection.service";

export const dynamic = "force-dynamic";

/** GET /api/leases/:id/inspections — this lease's condition records, with photos. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    const { id } = await params;
    const data = await listLeaseInspections(session, id);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list inspections");
  }
}

/** POST /api/leases/:id/inspections  { type, notes? } — record one (owner/landlord/agent). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const data = await createInspection(session, id, body);
    return apiSuccess(data, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to record inspection");
  }
}
