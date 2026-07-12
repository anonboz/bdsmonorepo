// THIN route handler: resolve session → call service → shape response.
// No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { listApplications } from "@/services/application.service";

export const dynamic = "force-dynamic";

/** GET /api/applications?status=submitted&take=20&skip=0 — this org's applications. */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const url = new URL(req.url);
    const data = await listApplications(session, {
      status: url.searchParams.get("status") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list applications");
  }
}
