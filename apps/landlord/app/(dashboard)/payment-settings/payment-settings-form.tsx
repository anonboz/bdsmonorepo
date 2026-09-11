"use client";

// Org payment settings editor: which methods are accepted, cash instructions,
// and the receiving bank account for transfers. PUTs the whole object; the
// server re-validates and derives the bank name from the chosen BIN.

import { VN_BANKS } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { PaymentSettingsRow } from "@/services/payment-settings.service";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function PaymentSettingsForm({
  initial,
  canEdit,
}: {
  initial: PaymentSettingsRow;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [acceptCash, setAcceptCash] = useState(initial.acceptCash);
  const [acceptBankTransfer, setAcceptBankTransfer] = useState(initial.acceptBankTransfer);
  const [cashInstructions, setCashInstructions] = useState(initial.cashInstructions ?? "");
  const [bankBin, setBankBin] = useState(initial.bankBin ?? "");
  const [bankAccountNo, setBankAccountNo] = useState(initial.bankAccountNo ?? "");
  const [bankAccountName, setBankAccountName] = useState(initial.bankAccountName ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/payment-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        acceptCash,
        acceptBankTransfer,
        cashInstructions,
        bankBin,
        bankAccountNo,
        bankAccountName,
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

  const disabled = !canEdit || pending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Cash</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acceptCash}
            onChange={(e) => setAcceptCash(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-input"
          />
          Accept cash
        </label>
        <div className="space-y-1.5">
          <label htmlFor="cashInstructions" className="text-sm font-medium">
            Instructions shown to tenants
          </label>
          <textarea
            id="cashInstructions"
            value={cashInstructions}
            onChange={(e) => setCashInstructions(e.target.value)}
            disabled={disabled || !acceptCash}
            rows={2}
            maxLength={500}
            placeholder="e.g. Pay at the building office, Mon–Fri 9am–5pm."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Bank transfer</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={acceptBankTransfer}
            onChange={(e) => setAcceptBankTransfer(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-input"
          />
          Accept bank transfer (shows account details + VietQR on bills)
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="bankBin" className="text-sm font-medium">
              Bank
            </label>
            <select
              id="bankBin"
              value={bankBin}
              onChange={(e) => setBankBin(e.target.value)}
              disabled={disabled || !acceptBankTransfer}
              className={inputClass}
            >
              <option value="">Select a bank…</option>
              {VN_BANKS.map((b) => (
                <option key={b.bin} value={b.bin}>
                  {b.name} ({b.shortName})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bankAccountNo" className="text-sm font-medium">
              Account number
            </label>
            <input
              id="bankAccountNo"
              inputMode="numeric"
              value={bankAccountNo}
              onChange={(e) => setBankAccountNo(e.target.value.replace(/\D/g, ""))}
              disabled={disabled || !acceptBankTransfer}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bankAccountName" className="text-sm font-medium">
              Account holder name
            </label>
            <input
              id="bankAccountName"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value.toUpperCase())}
              disabled={disabled || !acceptBankTransfer}
              placeholder="AS PRINTED ON THE ACCOUNT, NO ACCENTS"
              className={inputClass}
            />
          </div>
        </div>
      </fieldset>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-primary">Saved.</p>}

      {canEdit && (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      )}
    </form>
  );
}
