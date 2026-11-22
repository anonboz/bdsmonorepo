"use client";

// Flat monthly fees editor, shared by the property page (defaults) and the
// lease page (the lease's own copy). Rules live in fee.service; this only
// collects input, calls the API and refreshes the server-rendered page.

import { FEE_KINDS, type FeeKindKey, formatMoney, parseMoneyToCents } from "@repo/shared";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export const FEE_KIND_LABELS: Record<FeeKindKey, string> = {
  internet: "Internet",
  trash: "Trash collection",
  parking: "Parking",
  cleaning: "Cleaning",
  other: "Other",
};

export type FeeItem = {
  id: string;
  kind: FeeKindKey;
  label: string | null;
  amount: number; // cents
  fromProperty?: boolean;
  customized?: boolean;
};

const field =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type ApiResult = { success: boolean; error?: { message?: string } };

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as ApiResult | null;
  return json?.success ? null : (json?.error?.message ?? "Request failed");
}

/** Whole currency units for an <input>, from cents. */
const toInput = (cents: number) => String(Math.round(cents / 100));

export function FeesManager({
  title,
  description,
  collectionUrl,
  itemUrlPrefix,
  initialFees,
  canEdit,
  showOrigin = false,
}: {
  title: string;
  description: string;
  /** POST target, e.g. /api/properties/:id/fees */
  collectionUrl: string;
  /** PATCH/DELETE prefix, e.g. /api/property-fees */
  itemUrlPrefix: string;
  initialFees: FeeItem[];
  canEdit: boolean;
  /** Lease view: badge whether each fee came from the property or was edited. */
  showOrigin?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<FeeKindKey>("internet");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editAmount, setEditAmount] = useState("");

  const total = initialFees.reduce((sum, f) => sum + f.amount, 0);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    const err = await fn();
    setBusy(false);
    if (err) {
      setError(err);
      return false;
    }
    router.refresh();
    return true;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    let cents: number;
    try {
      cents = parseMoneyToCents(amount);
    } catch {
      setError("Enter a valid amount");
      return;
    }
    const ok = await run(() =>
      send(collectionUrl, "POST", { kind, label: label || undefined, amount: cents }),
    );
    if (ok) {
      setLabel("");
      setAmount("");
    }
  }

  function startEdit(fee: FeeItem) {
    setEditingId(fee.id);
    setEditLabel(fee.label ?? "");
    setEditAmount(toInput(fee.amount));
    setError(null);
  }

  async function onSave(fee: FeeItem) {
    let cents: number;
    try {
      cents = parseMoneyToCents(editAmount);
    } catch {
      setError("Enter a valid amount");
      return;
    }
    const ok = await run(() =>
      send(`${itemUrlPrefix}/${fee.id}`, "PATCH", {
        amount: cents,
        ...(editLabel.trim() ? { label: editLabel } : {}),
      }),
    );
    if (ok) setEditingId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {initialFees.length === 0 ? (
          <p className="text-sm text-muted-foreground">No monthly fees yet.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {initialFees.map((fee) => (
                <tr key={fee.id} className="border-b last:border-0">
                  {editingId === fee.id ? (
                    <>
                      <td className="py-2 pr-2">
                        <span className="block text-xs text-muted-foreground">
                          {FEE_KIND_LABELS[fee.kind]}
                        </span>
                        <input
                          aria-label="Label"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="Label (optional)"
                          className={field}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          aria-label="Monthly amount"
                          type="number"
                          min={0}
                          step="any"
                          value={editAmount}
                          onChange={(e) => setEditAmount(e.target.value)}
                          className={field}
                        />
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button size="sm" disabled={busy} onClick={() => onSave(fee)}>
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 pr-2">
                        <span className="font-medium">
                          {fee.label ?? FEE_KIND_LABELS[fee.kind]}
                        </span>
                        {fee.label && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {FEE_KIND_LABELS[fee.kind]}
                          </span>
                        )}
                        {showOrigin && (
                          <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {!fee.fromProperty
                              ? "Lease only"
                              : fee.customized
                                ? "Changed on lease"
                                : "From property"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2">{formatMoney(fee.amount)}/mo</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {canEdit && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => startEdit(fee)}
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                run(() => send(`${itemUrlPrefix}/${fee.id}`, "DELETE"))
                              }
                            >
                              Remove
                            </Button>
                          </>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              <tr>
                <td className="pt-2 font-medium">Total fees</td>
                <td className="pt-2 font-medium">{formatMoney(total)}/mo</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}

        {canEdit && (
          <form onSubmit={onAdd} className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem_auto]">
            <select
              aria-label="Fee type"
              value={kind}
              onChange={(e) => setKind(e.target.value as FeeKindKey)}
              className={field}
            >
              {FEE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FEE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              aria-label="Label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={kind === "other" ? "Label (required)" : "Label (optional)"}
              required={kind === "other"}
              className={field}
            />
            <input
              aria-label="Monthly amount"
              type="number"
              min={0}
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount / month"
              required
              className={field}
            />
            <Button type="submit" size="sm" disabled={busy} className="h-9">
              Add fee
            </Button>
          </form>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
