"use client";

// "Pay this bill": the methods the landlord accepts, as a vertical list. Cash
// shows instructions; bank transfer expands to account details + a VietQR code
// with copy buttons. Card / e-wallet / points are listed greyed-out so future
// rails slot in without a layout change. Everything here is presentation —
// amounts arrive pre-formatted and the QR payload is built server-side.

import { Banknote, Check, Copy, CreditCard, Landmark, Star, Wallet } from "lucide-react";
import { useState } from "react";

import { useTranslations } from "@/i18n/provider";
import { cn } from "@repo/ui";

export type PayBillCardProps = {
  cash: { instructions: string | null } | null;
  bankTransfer: {
    bankName: string;
    accountNo: string;
    accountName: string;
    amountLabel: string; // already formatted for the viewer's locale
    message: string;
    qrDataUrl: string; // data:image/png;base64,…
  } | null;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations("bills.detail.pay");
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context); the value is still visible.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${t("copy")} ${label}`}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-input px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("copied") : t("copy")}
    </button>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("truncate text-sm font-medium", mono && "font-mono")}>{value}</div>
      </div>
      <CopyButton value={value} label={label} />
    </div>
  );
}

export function PayBillCard({ cash, bankTransfer }: PayBillCardProps) {
  const t = useTranslations("bills.detail.pay");
  const [open, setOpen] = useState<"cash" | "bank" | null>(bankTransfer ? "bank" : "cash");

  const comingSoon = [
    { key: "card", icon: CreditCard },
    { key: "ewallet", icon: Wallet },
    { key: "points", icon: Star },
  ] as const;

  if (!cash && !bankTransfer) {
    return <p className="text-sm text-muted-foreground">{t("noMethods")}</p>;
  }

  return (
    <ul className="divide-y">
      {cash && (
        <li>
          <button
            type="button"
            onClick={() => setOpen(open === "cash" ? null : "cash")}
            aria-expanded={open === "cash"}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
          >
            <Banknote className="h-5 w-5 shrink-0 text-primary" />
            <span className="flex-1 text-sm font-medium">{t("cash")}</span>
          </button>
          {open === "cash" && (
            <p className="px-4 pb-4 pl-12 text-sm text-muted-foreground">
              {cash.instructions || t("cashDefault")}
            </p>
          )}
        </li>
      )}

      {bankTransfer && (
        <li>
          <button
            type="button"
            onClick={() => setOpen(open === "bank" ? null : "bank")}
            aria-expanded={open === "bank"}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
          >
            <Landmark className="h-5 w-5 shrink-0 text-primary" />
            <span className="flex-1 text-sm font-medium">{t("bankTransfer")}</span>
            <span className="text-xs text-muted-foreground">{bankTransfer.bankName}</span>
          </button>
          {open === "bank" && (
            <div className="grid gap-4 px-4 pb-4 sm:grid-cols-[auto_1fr] sm:pl-12">
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={bankTransfer.qrDataUrl}
                  alt={t("qrAlt")}
                  width={176}
                  height={176}
                  className="h-44 w-44 rounded-md border bg-white p-1"
                />
                <p className="max-w-44 text-center text-xs text-muted-foreground">
                  {t("scanHint")}
                </p>
              </div>
              <div className="divide-y">
                <Row label={t("bank")} value={bankTransfer.bankName} />
                <Row label={t("accountNo")} value={bankTransfer.accountNo} mono />
                <Row label={t("accountName")} value={bankTransfer.accountName} />
                <Row label={t("amount")} value={bankTransfer.amountLabel} />
                <Row label={t("message")} value={bankTransfer.message} mono />
              </div>
            </div>
          )}
        </li>
      )}

      {comingSoon.map(({ key, icon: Icon }) => (
        <li key={key} className="flex items-center gap-3 px-4 py-3 opacity-50" aria-disabled="true">
          <Icon className="h-5 w-5 shrink-0" />
          <span className="flex-1 text-sm font-medium">{t(key)}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {t("comingSoon")}
          </span>
        </li>
      ))}
    </ul>
  );
}
