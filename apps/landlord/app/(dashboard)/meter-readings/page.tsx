import { format } from "date-fns";

import { getSession } from "@/lib/session";
import {
  listMeterReadings,
  listOverdueReadings,
  listUnitOptions,
} from "@/services/meter-reading.service";
import { Card, CardContent } from "@repo/ui";

import { MeterReadingsManager } from "./meter-readings-manager";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { water: "Water", electricity: "Electricity" };

export default async function MeterReadingsPage() {
  const session = await getSession();
  const [units, readings, overdue] = await Promise.all([
    listUnitOptions(session),
    listMeterReadings(session, {}),
    listOverdueReadings(session),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Meter readings</h1>
        <p className="text-muted-foreground">
          Record water and electricity meter readings per unit. Consumption for billing is the
          difference from each unit&apos;s previous reading — no need to type a usage number by
          hand.
        </p>
      </header>

      {overdue.length > 0 && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-medium">
              {overdue.length} reading{overdue.length === 1 ? "" : "s"} not yet taken this month
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {overdue.map((o) => (
                <li key={`${o.unitId}:${o.kind}`}>
                  {o.propertyName} · {o.unitLabel} — {KIND_LABEL[o.kind]}
                  {o.lastReadingDate
                    ? ` (last: ${format(new Date(o.lastReadingDate), "MMM d, yyyy")})`
                    : " (never read)"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          <MeterReadingsManager units={units} initialRows={readings} />
        </CardContent>
      </Card>
    </div>
  );
}
