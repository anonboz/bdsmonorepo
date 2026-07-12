// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createLease, listLeases } from "@/services/lease.service";

export const dynamic = "force-dynamic";

/** GET /api/leases?status=active&take=20&skip=0 — this org's leases. */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const data = await listLeases(session, {
      status: url.searchParams.get("status") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list leases");
  }
}

/** POST /api/leases — create a draft lease (owner/landlord/agent only). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const body = await req.json();
    const lease = await createLease(session, body);
    return apiSuccess(lease, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to create lease");
  }
}
