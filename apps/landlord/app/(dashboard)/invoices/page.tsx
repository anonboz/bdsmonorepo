import { getSession } from "@/lib/session";
import { listLeases } from "@/services/lease.service";
import { listMeterReadings } from "@/services/meter-reading.service";
import { listUtilityRates } from "@/services/utility-rate.service";
import { Card, CardContent } from "@repo/ui";

import {
  GenerateInvoiceForm,
  type LeaseOption,
  type RateHint,
  type UnbilledReading,
} from "./generate-invoice-form";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const session = await getSession();
  const [{ rows: leases }, rates, unbilled] = await Promise.all([
    listLeases(session, { take: "100" }),
    listUtilityRates(session),
    listMeterReadings(session, { unbilledOnly: true }),
  ]);

  const leaseOptions: LeaseOption[] = leases.map((l) => ({
    id: l.id,
    unitId: l.unitId,
    label: `${l.unit.property.name} · ${l.unit.label}`,
  }));
  const rateHints: RateHint[] = rates.map((r) => ({
    kind: r.kind,
    unit: r.unit,
    pricePerUnit: r.pricePerUnit,
  }));
  const unbilledReadings: UnbilledReading[] = unbilled.map((r) => ({
    id: r.id,
    unitId: r.unitId,
    kind: r.kind,
    value: r.value,
    previousValue: r.previousValue,
    consumption: r.consumption,
    readingDate: r.readingDate,
    photoUrl: r.photoUrl,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Generate invoice</h1>
        <p className="text-muted-foreground">
          Bill a lease for a period. Rent comes from the lease; water and electricity are priced as
          consumption × your organization&apos;s current rate — picked from a recorded meter reading
          when one is available, or typed in by hand otherwise.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <GenerateInvoiceForm
            leases={leaseOptions}
            rates={rateHints}
            unbilledReadings={unbilledReadings}
          />
        </CardContent>
      </Card>
    </div>
  );
}
