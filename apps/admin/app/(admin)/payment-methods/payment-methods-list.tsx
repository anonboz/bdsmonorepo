"use client";

// Catalog editor: enable/disable each method platform-wide and reorder the
// list (the order is what tenants see). Each change PATCHes one row and
// refreshes the server-rendered list.

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PAYMENT_METHOD_LABELS, type PaymentMethodKey } from "@repo/shared";
import { Button } from "@repo/ui";

export type CatalogRow = {
  key: PaymentMethodKey;
  enabled: boolean;
  sortOrder: number;
  live: boolean;
};

export function PaymentMethodsList({ rows }: { rows: CatalogRow[] }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(key: string, body: { enabled?: boolean; move?: "up" | "down" }) {
    setPending(key);
    setError(null);
    const res = await fetch(`/api/admin/payment-methods/${key}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setPending(null);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to update");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Method</th>
            <th className="px-4 py-3 font-medium">Rail</th>
            <th className="px-4 py-3 font-medium">Enabled</th>
            <th className="px-4 py-3 font-medium">Order</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="border-b last:border-0">
              <td className="px-4 py-3 font-medium">{PAYMENT_METHOD_LABELS[r.key]}</td>
              <td className="px-4 py-3">
                <span
                  className={
                    r.live
                      ? "inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                      : "inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  }
                >
                  {r.live ? "Live" : "Coming soon"}
                </span>
              </td>
              <td className="px-4 py-3">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={pending !== null}
                    onChange={(e) => patch(r.key, { enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-input"
                    aria-label={`Enable ${PAYMENT_METHOD_LABELS[r.key]}`}
                  />
                  <span className="text-muted-foreground">{r.enabled ? "On" : "Off"}</span>
                </label>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null || i === 0}
                    onClick={() => patch(r.key, { move: "up" })}
                    aria-label={`Move ${PAYMENT_METHOD_LABELS[r.key]} up`}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null || i === rows.length - 1}
                    onClick={() => patch(r.key, { move: "down" })}
                    aria-label={`Move ${PAYMENT_METHOD_LABELS[r.key]} down`}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
