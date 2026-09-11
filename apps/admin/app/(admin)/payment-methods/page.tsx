import { getSession, requireAdmin } from "@/lib/session";
import { listPaymentMethods } from "@/services/payment-method.service";
import { Card, CardContent } from "@repo/ui";

import { PaymentMethodsList } from "./payment-methods-list";

export const dynamic = "force-dynamic";

export default async function PaymentMethodsPage() {
  const session = await getSession();
  requireAdmin(session);
  const rows = await listPaymentMethods(session);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Payment methods</h1>
        <p className="text-muted-foreground">
          The platform-wide list of ways tenants can pay. Landlords choose which enabled methods
          they accept and enter their own bank details. Methods without a live rail yet are shown to
          tenants as &ldquo;coming soon&rdquo; when enabled.
        </p>
      </header>

      <Card>
        <CardContent className="p-0">
          <PaymentMethodsList rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
