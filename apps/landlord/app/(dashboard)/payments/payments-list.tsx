"use client";

// Tenant-reported payments with confirm / reject actions on pending rows.
// Each action PATCHes the API and refreshes the server-rendered list.

import { format } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoney, PAYMENT_METHOD_LABELS, isPaymentMethodKey } from "@repo/shared";
import { Button } from "@repo/ui";

export type PaymentListRow = {
  id: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string; // ISO
  paidAt: string | null; // ISO
  invoiceId: string;
  invoiceStatus: string;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  property: string;
  unitLabel: string;
  tenant: string;
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-accent/15 text-accent-foreground",
  succeeded: "bg-primary/15 text-primary",
  failed: "bg-destructive/15 text-destructive",
  refunded: "bg-muted text-muted-foreground",
};

export function PaymentsList({
  rows,
  canConfirm,
}: {
  rows: PaymentListRow[];
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "confirm" | "reject") {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/payments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const json = await res.json();
    setBusy(null);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to update payment");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead className="border-b text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Reported</th>
            <th className="px-4 py-3 font-medium">Tenant</th>
            <th className="px-4 py-3 font-medium">Bill</th>
            <th className="px-4 py-3 font-medium">Method</th>
            <th className="px-4 py-3 font-medium">Amount</th>
            <th className="px-4 py-3 font-medium">Status</th>
            {canConfirm && <th className="px-4 py-3 font-medium sr-only">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="px-4 py-3 text-muted-foreground">
                {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
              </td>
              <td className="px-4 py-3">{r.tenant}</td>
              <td className="px-4 py-3">
                <span className="font-medium">{r.property}</span>
                <span className="text-muted-foreground"> · {r.unitLabel}</span>
                <span className="block text-xs text-muted-foreground">
                  {format(new Date(r.periodStart), "MMM d")} –{" "}
                  {format(new Date(r.periodEnd), "MMM d, yyyy")}
                </span>
              </td>
              <td className="px-4 py-3">
                {isPaymentMethodKey(r.method) ? PAYMENT_METHOD_LABELS[r.method] : r.method}
              </td>
              <td className="px-4 py-3">{formatMoney(r.amount)}</td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                    STATUS_STYLES[r.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.status}
                </span>
              </td>
              {canConfirm && (
                <td className="px-4 py-3">
                  {r.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => act(r.id, "confirm")}
                      >
                        {busy === r.id ? "Saving…" : "Confirm"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => act(r.id, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Link
                      href={`/leases?invoice=${r.invoiceId}`}
                      className="text-xs text-muted-foreground hover:underline"
                    >
                      {r.paidAt ? `Paid ${format(new Date(r.paidAt), "MMM d")}` : "—"}
                    </Link>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
