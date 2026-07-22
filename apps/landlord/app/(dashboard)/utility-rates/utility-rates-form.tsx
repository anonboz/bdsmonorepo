"use client";

// Per-utility rate editor. Owner enters a price per consumption unit (in major
// currency units); we convert to integer cents and PUT it. The admin's min/max
// bound is shown as a hint and re-enforced server-side.

import { formatMoney } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type RateRow = {
  kind: "water" | "electricity";
  unit: string;
  pricePerUnit: number | null;
  min: number;
  max: number;
};

const KIND_LABEL: Record<RateRow["kind"], string> = {
  water: "Water",
  electricity: "Electricity",
};

function centsToMajor(cents: number): string {
  return String(cents / 100);
}

function RateEditor({ row }: { row: RateRow }) {
  const router = useRouter();
  const [value, setValue] = useState(
    row.pricePerUnit != null ? centsToMajor(row.pricePerUnit) : "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const cents = Math.round(Number.parseFloat(value) * 100);
    const res = await fetch("/api/utility-rates", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: row.kind, pricePerUnit: Number.isNaN(cents) ? "" : cents }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 font-medium">{KIND_LABEL[row.kind]}</td>
      <td className="px-4 py-3 text-muted-foreground">{row.unit}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {formatMoney(row.min)} – {formatMoney(row.max)} / {row.unit}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            className="h-9 w-28 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" size="sm" onClick={onSave} disabled={pending || value === ""}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-xs text-primary">Saved</span>}
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

export function UtilityRatesForm({ rows }: { rows: RateRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-muted-foreground">
        <tr>
          <th className="px-4 py-3 font-medium">Utility</th>
          <th className="px-4 py-3 font-medium">Unit</th>
          <th className="px-4 py-3 font-medium">Allowed range</th>
          <th className="px-4 py-3 font-medium">Price per unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <RateEditor key={row.kind} row={row} />
        ))}
      </tbody>
    </table>
  );
}
