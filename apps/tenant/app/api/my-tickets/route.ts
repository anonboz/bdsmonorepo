// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { listMyTickets } from "@/services/ticket.service";

export const dynamic = "force-dynamic";

/** GET /api/my-tickets — maintenance requests this tenant reported, across orgs. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await listMyTickets(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list requests");
  }
}
