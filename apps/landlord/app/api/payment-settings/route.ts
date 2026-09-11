// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { getPaymentSettings, upsertPaymentSettings } from "@/services/payment-settings.service";

export const dynamic = "force-dynamic";

/** GET /api/payment-settings — how this org accepts rent payments. */
export async function GET() {
  try {
    const session = await getSession();
    const data = await getPaymentSettings(session);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to load payment settings");
  }
}

/** PUT /api/payment-settings — replace the org's payment settings (owner/landlord). */
export async function PUT(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord");
    const body = await req.json();
    const data = await upsertPaymentSettings(session, body);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to save payment settings");
  }
}
