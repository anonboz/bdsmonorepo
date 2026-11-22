// THIN route handler: resolve session → gate role on writes → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createPropertyFee, listPropertyFees } from "@/services/fee.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/properties/:id/fees — this property's flat monthly fees. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    const { id } = await params;
    return apiSuccess(await listPropertyFees(session, id));
  } catch (err) {
    return handleRouteError(err, "Failed to list fees");
  }
}

/** POST /api/properties/:id/fees — add a fee { kind, label?, amount } (owner/landlord). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    const body = await req.json();
    return apiSuccess(await createPropertyFee(session, id, body), 201);
  } catch (err) {
    return handleRouteError(err, "Failed to add fee");
  }
}
