"use client";

// Min/max bound editor for each metered utility. Admin enters prices in major
// currency units; we convert to integer cents/unit and PUT them. These bounds
// gate what every owner can charge.

import { formatMoney } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type BoundRow = {
  kind: "water" | "electricity";
  unit: string;
  min: number | null;
  max: number | null;
};

const KIND_LABEL: Record<BoundRow["kind"], string> = {
  water: "Water",
  electricity: "Electricity",
};

const majorOrEmpty = (cents: number | null) => (cents != null ? String(cents / 100) : "");
const toCents = (major: string) => {
  const n = Math.round(Number.parseFloat(major) * 100);
  return Number.isNaN(n) ? "" : n;
};

function BoundEditor({ row }: { row: BoundRow }) {
  const router = useRouter();
  const [min, setMin] = useState(majorOrEmpty(row.min));
  const [max, setMax] = useState(majorOrEmpty(row.max));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave() {
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/admin/utility-bounds", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: row.kind,
        unit: row.unit,
        minPricePerUnit: toCents(min),
        maxPricePerUnit: toCents(max),
      }),
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

  const current =
    row.min != null && row.max != null
      ? `${formatMoney(row.min)} – ${formatMoney(row.max)} / ${row.unit}`
      : "Not set";

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3 font-medium">{KIND_LABEL[row.kind]}</td>
      <td className="px-4 py-3 text-muted-foreground">{row.unit}</td>
      <td className="px-4 py-3 text-muted-foreground">{current}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0"
            value={min}
            onChange={(e) => {
              setMin(e.target.value);
              setSaved(false);
            }}
            aria-label="Minimum"
            placeholder="min"
            className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={max}
            onChange={(e) => {
              setMax(e.target.value);
              setSaved(false);
            }}
            aria-label="Maximum"
            placeholder="max"
            className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="button"
            size="sm"
            onClick={onSave}
            disabled={pending || min === "" || max === ""}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved && <span className="text-xs text-primary">Saved</span>}
        </div>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

export function UtilityBoundsForm({ rows }: { rows: BoundRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b text-left text-muted-foreground">
        <tr>
          <th className="px-4 py-3 font-medium">Utility</th>
          <th className="px-4 py-3 font-medium">Unit</th>
          <th className="px-4 py-3 font-medium">Current bound</th>
          <th className="px-4 py-3 font-medium">Set min – max / unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <BoundEditor key={row.kind} row={row} />
        ))}
      </tbody>
    </table>
  );
}
