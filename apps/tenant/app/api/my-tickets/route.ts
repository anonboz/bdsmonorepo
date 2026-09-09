// THIN route handler: resolve session → call service → shape response. No
// business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { createMyTicket, listMyTickets } from "@/services/ticket.service";

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

/** POST /api/my-tickets  { leaseId, title, description?, priority? } — raise a request. */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    const body: unknown = await req.json().catch(() => ({}));
    const data = await createMyTicket(session, body);
    return apiSuccess(data, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to submit request");
  }
}
