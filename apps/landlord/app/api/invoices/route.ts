// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { generateInvoice } from "@/services/invoice.service";

export const dynamic = "force-dynamic";

/** POST /api/invoices — generate a rent invoice for a lease (owner/landlord/agent). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const body = await req.json();
    const invoice = await generateInvoice(session, body);
    return apiSuccess(invoice, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to generate invoice");
  }
}
