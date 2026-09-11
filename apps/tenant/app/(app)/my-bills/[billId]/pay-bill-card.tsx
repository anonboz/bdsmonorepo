"use client";

// "Pay this bill": the methods the landlord accepts (and the admin has enabled),
// in the admin's order. Cash shows instructions; bank transfer expands to
// account details + a VietQR code with copy buttons. Each live method has an
// "I've paid" button that reports a pending payment for the landlord to
// confirm. Methods without a rail yet are listed greyed-out. Everything here
// is presentation — amounts arrive pre-formatted and the QR payload is built
// server-side.

import { Banknote, Check, Clock, Copy, CreditCard, Landmark, Star, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTranslations } from "@/i18n/provider";
import type { PaymentMethodKey } from "@repo/shared";
import { Button, cn } from "@repo/ui";

export type PayBillCardProps = {
  billId: string;
  /** Admin-enabled methods in display order. */
  methods: PaymentMethodKey[];
  cash: { instructions: string | null } | null;
  bankTransfer: {
    bankName: string;
    accountNo: string;
    accountName: string;
    amountLabel: string; // already formatted for the viewer's locale
    message: string;
    qrDataUrl: string; // data:image/png;base64,…
  } | null;
  /** A reported payment awaiting the landlord, if any (pre-formatted). */
  pendingPayment: { method: PaymentMethodKey; amountLabel: string; date: string } | null;
};

const ICONS: Record<PaymentMethodKey, typeof Banknote> = {
  cash: Banknote,
  bank_transfer: Landmark,
  card: CreditCard,
  ewallet: Wallet,
  points: Star,
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

export function PayBillCard({
  billId,
  methods,
  cash,
  bankTransfer,
  pendingPayment,
}: PayBillCardProps) {
  const t = useTranslations("bills.detail.pay");
  const router = useRouter();
  const [open, setOpen] = useState<PaymentMethodKey | null>(
    bankTransfer ? "bank_transfer" : cash ? "cash" : null,
  );
  const [reporting, setReporting] = useState<PaymentMethodKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function report(method: "cash" | "bank_transfer") {
    setReporting(method);
    setError(null);
    const res = await fetch(`/api/my-bills/${billId}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method }),
    });
    const json = await res.json().catch(() => null);
    setReporting(null);
    if (!res.ok || !json?.success) {
      setError(json?.error?.message ?? t("reportFailed"));
      return;
    }
    router.refresh();
  }

  const offered = methods.filter((m) =>
    m === "cash" ? cash !== null : m === "bank_transfer" ? bankTransfer !== null : true,
  );
  if (offered.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t("noMethods")}</p>;
  }

  const methodLabel = (m: PaymentMethodKey) => (m === "bank_transfer" ? t("bankTransfer") : t(m));

  return (
    <div>
      {pendingPayment && (
        <div className="flex gap-3 border-b bg-accent/10 px-4 py-3">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground" />
          <div className="text-sm">
            <p className="font-medium">{t("pendingTitle")}</p>
            <p className="text-muted-foreground">
              {t("pendingBody", {
                method: methodLabel(pendingPayment.method),
                amount: pendingPayment.amountLabel,
                date: pendingPayment.date,
              })}
            </p>
          </div>
        </div>
      )}

      <ul className="divide-y">
        {offered.map((m) => {
          const Icon = ICONS[m];
          const live = m === "cash" || m === "bank_transfer";
          if (!live) {
            return (
              <li
                key={m}
                className="flex items-center gap-3 px-4 py-3 opacity-50"
                aria-disabled="true"
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-sm font-medium">{methodLabel(m)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {t("comingSoon")}
                </span>
              </li>
            );
          }
          const isOpen = open === m;
          return (
            <li key={m}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : m)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
              >
                <Icon className="h-5 w-5 shrink-0 text-primary" />
                <span className="flex-1 text-sm font-medium">{methodLabel(m)}</span>
                {m === "bank_transfer" && bankTransfer && (
                  <span className="text-xs text-muted-foreground">{bankTransfer.bankName}</span>
                )}
              </button>

              {isOpen && m === "cash" && cash && (
                <div className="space-y-3 px-4 pb-4 sm:pl-12">
                  <p className="text-sm text-muted-foreground">
                    {cash.instructions || t("cashDefault")}
                  </p>
                  {!pendingPayment && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={reporting !== null}
                      onClick={() => report("cash")}
                    >
                      {reporting === "cash" ? t("reporting") : t("reportCash")}
                    </Button>
                  )}
                </div>
              )}

              {isOpen && m === "bank_transfer" && bankTransfer && (
                <div className="space-y-3 px-4 pb-4 sm:pl-12">
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
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
                  {!pendingPayment && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={reporting !== null}
                      onClick={() => report("bank_transfer")}
                    >
                      {reporting === "bank_transfer" ? t("reporting") : t("reportBank")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
    </div>
  );
}
