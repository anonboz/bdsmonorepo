// THIN route handler: resolve session → gate role → call service → shape
// response. No business logic, no Prisma here.

import { z } from "zod";

import { apiSuccess, handleRouteError } from "@/lib/api";
import { getSession, requireRole } from "@/lib/session";
import { confirmPayment, rejectPayment } from "@/services/payment.service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["confirm", "reject"]) });

/** PATCH /api/payments/:id  { action: "confirm" | "reject" }  (owner/landlord/agent) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    requireRole(session, "owner", "landlord", "agent");
    const { id } = await params;
    const { action } = bodySchema.parse(await req.json());
    const data =
      action === "confirm" ? await confirmPayment(session, id) : await rejectPayment(session, id);
    return apiSuccess(data);
  } catch (err) {
    return handleRouteError(err, "Failed to update payment");
  }
}
