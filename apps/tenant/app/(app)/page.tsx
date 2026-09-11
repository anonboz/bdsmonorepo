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
    listMyAnnouncements(session, { limit: 1 }),
  ]);
  const t = await getTranslations("home");
  const ta = await getTranslations("announcements");
  const latest = announcements[0];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">
          {t("welcome", { name: session.name || "tenant" })}
        </h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </header>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Megaphone className="h-5 w-5 text-primary" />
            {ta("title")}
          </CardTitle>
          <Link
            href="/announcements"
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            {ta("viewAll")}
          </Link>
        </CardHeader>
        <CardContent>
          {latest ? (
            <Link href="/announcements" className="flex items-center gap-2">
              <span
                className={
                  latest.kind === "system"
                    ? "inline-flex shrink-0 items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                    : "inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                }
              >
                {latest.kind === "system" ? ta("system") : latest.source}
              </span>
              <span className="truncate text-sm font-medium">{latest.title}</span>
              <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline">
                {latest.body}
              </span>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">{ta("empty")}</p>
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
