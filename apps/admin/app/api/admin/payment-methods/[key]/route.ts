// THIN route handler: resolve session → gate admin role → call service → shape
// response. No business logic, no Prisma here. Admin is global — no org scope.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireAdmin } from "@/lib/session";
import { updatePaymentMethod } from "@/services/payment-method.service";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/payment-methods/:key  { enabled?, move?: "up"|"down" } */
export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const session = await getSession();
    requireAdmin(session);
    const { key } = await params;
    const body = await req.json();
    const data = await updatePaymentMethod(session, key, body);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to update payment method");
  }
}
