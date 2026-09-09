"use client";

// Collapsible "Add unit" form, scoped to one property.

import { parseMoneyToCents } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

export function UnitForm({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [bedrooms, setBedrooms] = useState("0");
  const [bathrooms, setBathrooms] = useState("1");
  const [rentAmount, setRentAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLabel("");
    setBedrooms("0");
    setBathrooms("1");
    setRentAmount("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    let rentCents: number;
    try {
      rentCents = parseMoneyToCents(rentAmount);
    } catch {
      setPending(false);
      setError("Enter a valid rent amount");
      return;
    }
    const res = await fetch("/api/units", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyId,
        label,
        bedrooms: Number(bedrooms),
        bathrooms: Number(bathrooms),
        rentAmount: rentCents,
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to add unit");
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        + Add unit
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <label className={labelCls}>Label</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Apt 2B"
            required
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Bedrooms</label>
          <input
            type="number"
            min={0}
            value={bedrooms}
            onChange={(e) => setBedrooms(e.target.value)}
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Bathrooms</label>
          <input
            type="number"
            min={0}
            step="0.5"
            value={bathrooms}
            onChange={(e) => setBathrooms(e.target.value)}
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Monthly rent</label>
          <input
            type="number"
            min={0}
            step="any"
            value={rentAmount}
            onChange={(e) => setRentAmount(e.target.value)}
            required
            className={field}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add unit"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
