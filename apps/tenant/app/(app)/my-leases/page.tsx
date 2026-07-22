import { format } from "date-fns";

import { getLocale, getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { listMyLeases } from "@/services/lease.service";
import { formatMoney } from "@repo/shared";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  active: "bg-primary/15 text-primary",
  ended: "bg-muted text-muted-foreground",
  terminated: "bg-destructive/15 text-destructive",
  renewed: "bg-accent/15 text-accent-foreground",
};

export default async function MyLeasesPage() {
  const session = await getSession();
  const { rows, total } = await listMyLeases(session);
  const t = await getTranslations("leases");
  const locale = await getLocale();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle", { count: total })}</p>
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
                  <th className="px-4 py-3 font-medium">{t("colTerm")}</th>
                  <th className="px-4 py-3 font-medium">{t("colRent")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lease) => (
                  <tr key={lease.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{lease.unit.property.name}</span>
                      <span className="text-muted-foreground"> · {lease.unit.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {lease.unit.property.city}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(lease.startDate, "MMM d, yyyy")} –{" "}
                      {format(lease.endDate, "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3">
                      {t("perMonth", { amount: formatMoney(lease.rentAmount, locale) })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[lease.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {t(`status.${lease.status}`)}
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
