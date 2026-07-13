// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { createProperty, listProperties } from "@/services/property.service";

export const dynamic = "force-dynamic";

/** GET /api/properties?type=house&take=20&skip=0 — this org's properties. */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const data = await listProperties(session, {
      type: url.searchParams.get("type") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list properties");
  }
}

/** POST /api/properties — create a property (owner/landlord only). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const body = await req.json();
    const property = await createProperty(session, body);
    return apiSuccess(property, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to create property");
  }
}
