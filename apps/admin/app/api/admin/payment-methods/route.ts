// THIN route handler: resolve session → gate admin role → call service → shape
// response. No business logic, no Prisma here. Admin is global — no org scope.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireAdmin } from "@/lib/session";
import { listPaymentMethods } from "@/services/payment-method.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/payment-methods — the platform payment method catalog. */
export async function GET() {
  try {
    const session = await getSession();
    requireAdmin(session);
    const data = await listPaymentMethods(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list payment methods");
  }
}
