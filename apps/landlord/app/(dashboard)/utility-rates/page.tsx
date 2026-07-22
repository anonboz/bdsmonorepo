import { getSession } from "@/lib/session";
import { listUtilityRates } from "@/services/utility-rate.service";
import { Card, CardContent } from "@repo/ui";

import { UtilityRatesForm } from "./utility-rates-form";

export const dynamic = "force-dynamic";

export default async function UtilityRatesPage() {
  const session = await getSession();
  const rows = await listUtilityRates(session);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Utility rates</h1>
        <p className="text-muted-foreground">
          Set your price per consumption unit. Invoice water and electricity charges are calculated
          as consumption × your rate. Prices must fall within the platform range.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No priceable utilities are configured yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <UtilityRatesForm rows={rows} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
