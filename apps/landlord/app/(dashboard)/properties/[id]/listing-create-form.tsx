"use client";

// Collapsible "Create listing" form, scoped to one unit. Prefills rent from
// the unit's own rentAmount (a listing may still override it for a promo).

import { parseMoneyToCents } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

function centsToMajor(cents: number): string {
  return String(cents / 100);
}

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

export function ListingCreateForm({
  unitId,
  unitRentAmount,
}: {
  unitId: string;
  unitRentAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [rentAmount, setRentAmount] = useState(() => centsToMajor(unitRentAmount));
  const [depositAmount, setDepositAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setRentAmount(centsToMajor(unitRentAmount));
    setDepositAmount("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    let rentCents: number;
    let depositCents: number;
    try {
      rentCents = parseMoneyToCents(rentAmount);
      depositCents = depositAmount.trim() === "" ? 0 : parseMoneyToCents(depositAmount);
    } catch {
      setPending(false);
      setError("Enter valid amounts");
      return;
    }
    const res = await fetch("/api/listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unitId, title, rentAmount: rentCents, depositAmount: depositCents }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to create listing");
      return;
    }
    reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        + New listing
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border bg-background p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-1">
          <label className={labelCls}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bright 1BR near downtown"
            required
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
        <div className="space-y-1.5">
          <label className={labelCls}>Deposit (optional)</label>
          <input
            type="number"
            min={0}
            step="any"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            className={field}
          />
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Creating…" : "Create listing"}
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
      <p className="text-xs text-muted-foreground">
        Created as a draft — publish it from the Listings page when it's ready.
      </p>
    </form>
  );
}
