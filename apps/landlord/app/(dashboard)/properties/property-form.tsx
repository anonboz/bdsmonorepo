"use client";

// Collapsible "Add property" form. Kept minimal — name, type, and address;
// latitude/longitude aren't exposed here (optional, no UI need yet).

import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

const PROPERTY_TYPES = ["apartment", "house", "condo", "townhouse", "room", "commercial"] as const;

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

export function PropertyForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof PROPERTY_TYPES)[number]>("apartment");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setType("apartment");
    setAddressLine1("");
    setCity("");
    setRegion("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        type,
        addressLine1,
        city,
        region: region.trim() === "" ? undefined : region.trim(),
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to add property");
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + Add property
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className={labelCls}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className={field}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <label className={labelCls}>Address</label>
          <input
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            required
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>City</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Region (optional)</label>
          <input value={region} onChange={(e) => setRegion(e.target.value)} className={field} />
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add property"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
