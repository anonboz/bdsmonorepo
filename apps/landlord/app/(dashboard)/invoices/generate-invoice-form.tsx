"use client";

// Generate a rent invoice: pick a lease, a billing period, and water/electricity
// consumption. Consumption comes from a recorded (unbilled) meter reading when
// one exists for the lease's unit — the delta from its previous reading is shown
// right in the picker — otherwise it falls back to a manually-typed number.
// Utility amounts = consumption × the org's current rate (computed server-side);
// the preview here mirrors that so the owner sees the total before/after saving.

import { formatMoney } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type LeaseOption = { id: string; unitId: string; label: string };
export type RateHint = { kind: "water" | "electricity"; unit: string; pricePerUnit: number | null };
export type UnbilledReading = {
  id: string;
  unitId: string;
  kind: "water" | "electricity";
  value: number;
  previousValue: number | null;
  consumption: number | null;
  readingDate: string; // ISO
  photoUrl: string | null;
};

type ResultLine = {
  kind: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  amount: number;
};
type Result = { id: string; amount: number; lineItems: ResultLine[] };

const KIND_LABEL: Record<string, string> = {
  rent: "Rent",
  water: "Water",
  electricity: "Electricity",
  other: "Other",
};

function isoFromDate(date: string): string {
  return `${date}T00:00:00.000Z`;
}

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

function UtilityField({
  kind,
  label,
  rateLabel,
  options,
  manualValue,
  onManualChange,
  readingId,
  onReadingChange,
}: {
  kind: "water" | "electricity";
  label: string;
  rateLabel: string;
  options: UnbilledReading[];
  manualValue: string;
  onManualChange: (v: string) => void;
  readingId: string;
  onReadingChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className={labelCls}>{label}</label>
      {options.length > 0 && (
        <select
          value={readingId}
          onChange={(e) => onReadingChange(e.target.value)}
          className={field}
        >
          <option value="">Enter manually</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {new Date(r.readingDate).toLocaleDateString()} — {r.value}
              {r.previousValue != null
                ? ` (prev ${r.previousValue} → +${r.consumption})`
                : " (baseline)"}
            </option>
          ))}
        </select>
      )}
      {(options.length === 0 || readingId === "") && (
        <input
          type="number"
          step="0.01"
          min="0"
          value={manualValue}
          onChange={(e) => onManualChange(e.target.value)}
          className={field}
          placeholder="0"
        />
      )}
      <p className="text-xs text-muted-foreground">
        Rate: {rateLabel}
        {kind === "water" ? " · m³" : " · kWh"}
      </p>
    </div>
  );
}

export function GenerateInvoiceForm({
  leases,
  rates,
  unbilledReadings,
}: {
  leases: LeaseOption[];
  rates: RateHint[];
  unbilledReadings: UnbilledReading[];
}) {
  const router = useRouter();
  const [leaseId, setLeaseId] = useState(leases[0]?.id ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [water, setWater] = useState("");
  const [electricity, setElectricity] = useState("");
  const [waterReadingId, setWaterReadingId] = useState("");
  const [electricityReadingId, setElectricityReadingId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const unitId = leases.find((l) => l.id === leaseId)?.unitId;
  const readingsFor = (kind: "water" | "electricity") =>
    unbilledReadings.filter((r) => r.unitId === unitId && r.kind === kind);

  function onLeaseChange(id: string) {
    setLeaseId(id);
    setWaterReadingId("");
    setElectricityReadingId("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leaseId,
        periodStart: isoFromDate(periodStart),
        periodEnd: isoFromDate(periodEnd),
        dueDate: isoFromDate(dueDate),
        ...(waterReadingId
          ? { waterReadingId }
          : { waterConsumption: water === "" ? undefined : Number(water) }),
        ...(electricityReadingId
          ? { electricityReadingId }
          : { electricityConsumption: electricity === "" ? undefined : Number(electricity) }),
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to generate invoice");
      return;
    }
    setResult(json.data);
    router.refresh();
  }

  const rateLabel = (kind: "water" | "electricity") => {
    const r = rates.find((x) => x.kind === kind);
    if (!r || r.pricePerUnit == null) return "no rate set";
    return `${formatMoney(r.pricePerUnit)} / ${r.unit}`;
  };

  return (
    <div className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="lease" className={labelCls}>
            Lease
          </label>
          <select
            id="lease"
            value={leaseId}
            onChange={(e) => onLeaseChange(e.target.value)}
            required
            className={field}
          >
            {leases.length === 0 && <option value="">No leases</option>}
            {leases.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="ps" className={labelCls}>
              Period start
            </label>
            <input
              id="ps"
              type="date"
              required
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pe" className={labelCls}>
              Period end
            </label>
            <input
              id="pe"
              type="date"
              required
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={field}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="dd" className={labelCls}>
              Due date
            </label>
            <input
              id="dd"
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={field}
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <UtilityField
            kind="water"
            label="Water consumption"
            rateLabel={rateLabel("water")}
            options={readingsFor("water")}
            manualValue={water}
            onManualChange={setWater}
            readingId={waterReadingId}
            onReadingChange={setWaterReadingId}
          />
          <UtilityField
            kind="electricity"
            label="Electricity consumption"
            rateLabel={rateLabel("electricity")}
            options={readingsFor("electricity")}
            manualValue={electricity}
            onManualChange={setElectricity}
            readingId={electricityReadingId}
            onReadingChange={setElectricityReadingId}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending || leaseId === ""}>
          {pending ? "Generating…" : "Generate invoice"}
        </Button>
      </form>

      {result && (
        <div className="rounded-md border">
          <div className="border-b px-4 py-3 text-sm font-medium">Invoice created</div>
          <table className="w-full text-sm">
            <tbody>
              {result.lineItems.map((li) => (
                <tr key={li.kind} className="border-b">
                  <td className="px-4 py-2">{KIND_LABEL[li.kind] ?? li.kind}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {li.quantity != null && li.unit ? `${li.quantity} ${li.unit}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">{formatMoney(li.amount)}</td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2 font-semibold" colSpan={2}>
                  Total
                </td>
                <td className="px-4 py-2 text-right font-semibold">{formatMoney(result.amount)}</td>
              </tr>
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            The tenant can now see this invoice in their bills.
          </p>
        </div>
      )}
    </div>
  );
}
