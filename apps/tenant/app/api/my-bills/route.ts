// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { listMyBills } from "@/services/bill.service";

export const dynamic = "force-dynamic";

/** GET /api/my-bills — rent invoices for this tenant, across all orgs. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listMyBills(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list bills");
  }
}
