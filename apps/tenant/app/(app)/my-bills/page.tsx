import { format } from "date-fns";
import Link from "next/link";

import { getLocale, getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { listMyBills } from "@/services/bill.service";
import { formatMoney } from "@repo/shared";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  open: "bg-primary/15 text-primary",
  partially_paid: "bg-accent/15 text-accent-foreground",
  paid: "bg-muted text-muted-foreground",
  overdue: "bg-destructive/15 text-destructive",
  void: "bg-muted text-muted-foreground",
};

export default async function MyBillsPage() {
  const session = await getSession();
  const { rows, outstanding } = await listMyBills(session);
  const t = await getTranslations("bills");
  const locale = await getLocale();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
        {outstanding > 0 && (
          <p className="text-sm font-medium text-destructive">
            {t("outstanding", { amount: formatMoney(outstanding, locale) })}
          </p>
        )}
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t("empty")}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("colProperty")}</th>
                  <th className="px-4 py-3 font-medium">{t("colPeriod")}</th>
                  <th className="px-4 py-3 font-medium">{t("colDue")}</th>
                  <th className="px-4 py-3 font-medium">{t("colAmount")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((bill) => (
                  <tr
                    key={bill.id}
                    className="border-b transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/my-bills/${bill.id}`} className="hover:underline">
                        <span className="font-medium">{bill.property}</span>
                        <span className="text-muted-foreground"> · {bill.unitLabel}</span>
                        <span className="block text-xs text-muted-foreground">{bill.city}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(bill.periodStart, "MMM d")} – {format(bill.periodEnd, "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(bill.dueDate, "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3">{formatMoney(bill.amount, locale)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[bill.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {t(`status.${bill.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
