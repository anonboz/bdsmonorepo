// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { deletePropertyFee, updatePropertyFee } from "@/services/fee.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/property-fees/:id — change { label?, amount? }; propagates to draft leases (owner/landlord). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    const body = await req.json();
    return apiSuccess(await updatePropertyFee(session, id, body));
  } catch (err) {
    return handleRouteError(err, "Failed to update fee");
  }
}

/** DELETE /api/property-fees/:id — remove the fee (owner/landlord). */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    return apiSuccess(await deletePropertyFee(session, id));
  } catch (err) {
    return handleRouteError(err, "Failed to delete fee");
  }
}
