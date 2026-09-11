// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { listOrgPayments } from "@/services/payment.service";

export const dynamic = "force-dynamic";

/** GET /api/payments — this org's tenant payments, pending first. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listOrgPayments(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list payments");
  }
}
