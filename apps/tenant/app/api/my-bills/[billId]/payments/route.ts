// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { reportMyPayment } from "@/services/bill.service";

export const dynamic = "force-dynamic";

/** POST /api/my-bills/:billId/payments  { method: "cash" | "bank_transfer" }
 *  — the tenant reports they paid the outstanding balance; lands as a pending
 *  Payment the landlord confirms. */
export async function POST(req: Request, { params }: { params: Promise<{ billId: string }> }) {
  try {
    const session = await getSession();
    const { billId } = await params;
    const body: unknown = await req.json().catch(() => ({}));
    const data = await reportMyPayment(session, billId, body);
    return apiSuccess(data, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to report payment");
  }
}
