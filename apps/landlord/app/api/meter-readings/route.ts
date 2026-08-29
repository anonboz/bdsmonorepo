// THIN route handler: resolve session → (gate role on writes) → call service →
// shape response. No business logic, no Prisma here.

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { listMeterReadings, recordMeterReading } from "@/services/meter-reading.service";

export const dynamic = "force-dynamic";

/** GET /api/meter-readings?unitId=&unbilledOnly= — this org's readings. */
export async function GET(req: Request) {
  try {
    const session = await getSession();
    const { searchParams } = new URL(req.url);
    const data = await listMeterReadings(session, Object.fromEntries(searchParams));
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to list meter readings");
  }
}

/** POST /api/meter-readings — record a reading for a unit (owner/landlord/agent). */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const body = await req.json();
    const created = await recordMeterReading(session, body);
    return apiSuccess(created, 201);
  } catch (err) {
    return handleRouteError(err, "Failed to record meter reading");
  }
}
