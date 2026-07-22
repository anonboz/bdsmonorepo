import { getSession } from "@/lib/session";
import { listLeases } from "@/services/lease.service";
import { listUtilityRates } from "@/services/utility-rate.service";
import { Card, CardContent } from "@repo/ui";

import { GenerateInvoiceForm, type LeaseOption, type RateHint } from "./generate-invoice-form";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await getSession();
  const [{ rows: leases }, rates] = await Promise.all([
    listLeases(session, { take: "100" }),
    listUtilityRates(session),
  ]);

  const leaseOptions: LeaseOption[] = leases.map((l) => ({
    id: l.id,
    label: `${l.unit.property.name} · ${l.unit.label}`,
  }));
  const rateHints: RateHint[] = rates.map((r) => ({
    kind: r.kind,
    unit: r.unit,
    pricePerUnit: r.pricePerUnit,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Generate invoice</h1>
        <p className="text-muted-foreground">
          Bill a lease for a period. Rent comes from the lease; water and electricity are priced as
          consumption × your organization&apos;s current rate.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <GenerateInvoiceForm leases={leaseOptions} rates={rateHints} />
        </CardContent>
      </Card>
    </div>
  );
}
