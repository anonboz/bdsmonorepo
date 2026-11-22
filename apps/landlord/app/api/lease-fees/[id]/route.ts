// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { deleteLeaseFee, updateLeaseFee } from "@/services/fee.service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/lease-fees/:id — change { label?, amount? }; marks it customized (owner/landlord). */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    const body = await req.json();
    return apiSuccess(await updateLeaseFee(session, id, body));
  } catch (err) {
    return handleRouteError(err, "Failed to update fee");
  }
}

/** DELETE /api/lease-fees/:id — remove the fee (owner/landlord). */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const { id } = await params;
    return apiSuccess(await deleteLeaseFee(session, id));
  } catch (err) {
    return handleRouteError(err, "Failed to delete fee");
  }
}
