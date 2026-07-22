import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { getMyBill, type MyBillDetail } from "@/services/bill.service";
import { NotFoundError, formatMoney } from "@repo/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  open: "bg-primary/15 text-primary",
  partially_paid: "bg-accent/15 text-accent-foreground",
  paid: "bg-muted text-muted-foreground",
  overdue: "bg-destructive/15 text-destructive",
  void: "bg-muted text-muted-foreground",
};

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  pending: "bg-secondary text-secondary-foreground",
  succeeded: "bg-primary/15 text-primary",
  failed: "bg-destructive/15 text-destructive",
  refunded: "bg-muted text-muted-foreground",
};

export default async function BillDetailPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = await params;
  const session = await getSession();
  const t = await getTranslations("bills.detail");
  // Reuse the list's invoice-status labels (sibling namespace).
  const tStatus = await getTranslations("bills.status");
  const locale = await getLocale();

  let bill: MyBillDetail;
  try {
    bill = await getMyBill(session, billId);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const money = (cents: number) => formatMoney(cents, locale);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <Link
        href="/my-bills"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("period", {
            start: format(bill.periodStart, "MMM d, yyyy"),
            end: format(bill.periodEnd, "MMM d, yyyy"),
          })}
        </p>
        <p className="text-sm text-muted-foreground">
          {bill.property} · {bill.unitLabel} —{" "}
          {[bill.addressLine1, bill.city, bill.region].filter(Boolean).join(", ")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("chargesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("colItem")}</th>
                <th className="px-4 py-3 font-medium">{t("colConsumption")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {bill.lineItems.map((li) => (
                <tr key={li.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{t(`lineKinds.${li.kind}`)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {li.quantity != null && li.unit ? `${li.quantity} ${li.unit}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">{money(li.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t">
              <tr>
                <td className="px-4 py-3 font-semibold" colSpan={2}>
                  {t("total")}
                </td>
                <td className="px-4 py-3 text-right font-semibold">{money(bill.amount)}</td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("summary")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">{t("colAmount")}</dt>
              <dd className="font-medium">{money(bill.amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colPaid")}</dt>
              <dd className="font-medium">{money(bill.paid)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colOutstanding")}</dt>
              <dd className="font-medium">{money(bill.outstanding)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colDue")}</dt>
              <dd className="font-medium">{format(bill.dueDate, "MMM d, yyyy")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colStatus")}</dt>
              <dd>
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[bill.status] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {tStatus(bill.status)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("colProperty")}</dt>
              <dd className="font-medium">
                {bill.property} · {bill.unitLabel}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("paymentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className={bill.payments.length === 0 ? undefined : "p-0"}>
          {bill.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("pDate")}</th>
                  <th className="px-4 py-3 font-medium">{t("pMethod")}</th>
                  <th className="px-4 py-3 font-medium">{t("pStatus")}</th>
                  <th className="px-4 py-3 font-medium">{t("pAmount")}</th>
                  <th className="px-4 py-3 font-medium">{t("pRef")}</th>
                </tr>
              </thead>
              <tbody>
                {bill.payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(p.paidAt ?? p.createdAt, "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3">{t(`methods.${p.method}`)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          PAYMENT_STATUS_STYLES[p.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {t(`paymentStatus.${p.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">{money(p.amount)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.providerRef ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
