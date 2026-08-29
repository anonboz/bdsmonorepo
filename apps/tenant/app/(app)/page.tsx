import { FileText, Megaphone, Receipt, Wrench } from "lucide-react";
import Link from "next/link";

import { getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { listMyAnnouncements } from "@/services/announcement.service";
import { listMyLeases } from "@/services/lease.service";
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function TenantHome() {
  const session = await getSession();
  const [{ total }, announcements] = await Promise.all([
    listMyLeases(session),
    listMyAnnouncements(session),
  ]);
  const t = await getTranslations("home");
  const ta = await getTranslations("announcements");

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">
          {t("welcome", { name: session.name || "tenant" })}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="h-5 w-5 text-primary" />
            {ta("title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{ta("empty")}</p>
          ) : (
            announcements.map((a) => (
              <div key={a.id} className="border-b pb-4 last:border-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      a.kind === "system"
                        ? "inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                        : "inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                    }
                  >
                    {a.kind === "system" ? ta("system") : a.source}
                  </span>
                  <h3 className="font-medium">{a.title}</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.body}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-primary" />
            {t("leasesTitle")}
          </CardTitle>
          <CardDescription>{t("leasesDesc", { count: total })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/my-leases" className={buttonVariants()}>
            {t("leasesCta")}
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Receipt className="h-5 w-5 text-primary" />
              {t("billsTitle")}
            </CardTitle>
            <CardDescription>{t("billsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/my-bills" className={buttonVariants({ variant: "outline" })}>
              {t("billsCta")}
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wrench className="h-5 w-5 text-primary" />
              {t("requestsTitle")}
            </CardTitle>
            <CardDescription>{t("requestsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/my-tickets" className={buttonVariants({ variant: "outline" })}>
              {t("requestsCta")}
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
