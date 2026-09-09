// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createListing } from "@/services/listing.service";

export const dynamic = "force-dynamic";

/** POST /api/listings — create a draft listing for a unit (owner/landlord/agent). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const body = await req.json();
    const listing = await createListing(session, body);
    return apiSuccess(listing, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to create listing");
  }
}
