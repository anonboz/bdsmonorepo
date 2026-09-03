// THIN route handler: parse query → call service → shape response. No business
// logic, no Prisma here. PUBLIC endpoint — no session, no auth.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { listPublicListings } from "@/services/listing.service";

export const dynamic = "force-dynamic";

/** GET /api/listings?city=&minRent=&maxRent=&sort=&take=&skip= — published listings. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const data = await listPublicListings({
      city: url.searchParams.get("city") ?? undefined,
      minRent: url.searchParams.get("minRent") ?? undefined,
      maxRent: url.searchParams.get("maxRent") ?? undefined,
      sort: url.searchParams.get("sort") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      skip: url.searchParams.get("skip") ?? undefined,
    });
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list listings");
  }
}
