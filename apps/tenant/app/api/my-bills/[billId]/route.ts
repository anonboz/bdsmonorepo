// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { getMyBill } from "@/services/bill.service";

export const dynamic = "force-dynamic";

/** GET /api/my-bills/:billId — one bill this tenant is on, with payment history. */
export async function GET(_req: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const session = await getSession();
    const { billId } = await params;
    const data = await getMyBill(session, billId);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to load bill");
  }
}
