import { getSession } from "@/lib/session";
import { listOrgPayments } from "@/services/payment.service";
import type { OrgRole } from "@repo/db";
import { Card, CardContent } from "@repo/ui";

import { PaymentsList, type PaymentListRow } from "./payments-list";

export const dynamic = "force-dynamic";

const CONFIRM_ROLES: readonly OrgRole[] = ["owner", "landlord", "agent"];

export default async function PaymentsPage() {
  const session = await getSession();
  const { rows, pending } = await listOrgPayments(session);
  const canConfirm = CONFIRM_ROLES.includes(session.role);

  // Dates → ISO strings so the rows can cross into the client list component.
  const serialized: PaymentListRow[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    periodStart: r.periodStart.toISOString(),
    periodEnd: r.periodEnd.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Payments</h1>
        <p className="text-muted-foreground">
          Payments your tenants reported by cash or bank transfer. Confirm once the money is in
          hand; the bill updates automatically.
        </p>
        {pending > 0 && (
          <p className="text-sm font-medium text-primary">{pending} waiting for confirmation</p>
        )}
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No payments reported yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <PaymentsList rows={serialized} canConfirm={canConfirm} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
