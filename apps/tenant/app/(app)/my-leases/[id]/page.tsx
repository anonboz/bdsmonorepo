import { format } from "date-fns";
import { ArrowLeft, Camera, Receipt } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLocale, getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { getMyLease } from "@/services/lease.service";
import { formatMoney, INSPECTION_TYPES, type InspectionKind } from "@repo/shared";
import {
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  active: "bg-primary/15 text-primary",
  ended: "bg-muted text-muted-foreground",
  terminated: "bg-destructive/15 text-destructive",
  renewed: "bg-accent/15 text-accent-foreground",
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  draft: "bg-secondary text-secondary-foreground",
  open: "bg-primary/15 text-primary",
  partially_paid: "bg-accent/15 text-accent-foreground",
  paid: "bg-muted text-muted-foreground",
  overdue: "bg-destructive/15 text-destructive",
  void: "bg-muted text-muted-foreground",
};

function isInspectionKind(value: string): value is InspectionKind {
  return (INSPECTION_TYPES as readonly string[]).includes(value);
}

export default async function MyLeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let lease: Awaited<ReturnType<typeof getMyLease>>;
  try {
    lease = await getMyLease(session, id);
  } catch {
    notFound();
  }

  const t = await getTranslations("leases");
  const tb = await getTranslations("bills");
  const locale = await getLocale();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <Link
          href="/my-leases"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " -ml-2"}
        >
          <ArrowLeft className="size-4" />
          {t("detail.back")}
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">
            {lease.unit.property.name} · {lease.unit.label}
          </h1>
          <p className="text-muted-foreground">{lease.unit.property.city}</p>
        </div>
        <span
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
            STATUS_STYLES[lease.status] ?? "bg-muted text-muted-foreground"
          }`}
        >
          {t(`status.${lease.status}`)}
        </span>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("detail.terms")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("detail.term")}</dt>
            <dd>
              {format(lease.startDate, "MMM d, yyyy")} – {format(lease.endDate, "MMM d, yyyy")}
            </dd>
            <dt className="text-muted-foreground">{t("detail.rent")}</dt>
            <dd>{formatMoney(lease.rentAmount, locale)}</dd>
            <dt className="text-muted-foreground">{t("detail.deposit")}</dt>
            <dd>{formatMoney(lease.depositAmount, locale)}</dd>
            <dt className="text-muted-foreground">{t("detail.signed")}</dt>
            <dd>
              {lease.signedAt
                ? t("detail.signed", { date: format(lease.signedAt, "MMM d, yyyy") })
                : t("detail.notSigned")}
            </dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("detail.dueDay", { day: lease.rentDueDay })}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Camera className="h-5 w-5 text-primary" />
            {t("detail.condition")}
          </CardTitle>
          <CardDescription>{t("detail.conditionHint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {lease.inspections.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("detail.conditionEmpty")}</p>
          ) : (
            lease.inspections.map((inspection) => (
              <div key={inspection.id} className="space-y-3 border-b pb-6 last:border-0 last:pb-0">
                <div>
                  <h3 className="font-medium">
                    {isInspectionKind(inspection.type)
                      ? t(`detail.inspectionTypes.${inspection.type}`)
                      : inspection.type}
                  </h3>
                  {inspection.completedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("detail.recordedOn", {
                        date: format(inspection.completedAt, "MMM d, yyyy"),
                      })}
                    </p>
                  )}
                </div>
                {inspection.notes && (
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {inspection.notes}
                  </p>
                )}
                {inspection.photos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("detail.noPhotos")}</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {inspection.photos.map((photo) => (
                      <a
                        key={photo.id}
                        href={photo.url}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-md border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt={t("detail.photoAlt")}
                          className="aspect-square w-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-primary" />
            {t("detail.bills")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lease.invoices.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">{t("detail.billsEmpty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">{t("detail.colPeriod")}</th>
                  <th className="px-4 py-3 font-medium">{t("detail.colDue")}</th>
                  <th className="px-4 py-3 font-medium">{t("detail.colAmount")}</th>
                  <th className="px-4 py-3 font-medium">{t("detail.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {lease.invoices.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/my-bills/${inv.id}`} className="hover:underline">
                        {format(inv.periodStart, "MMM d")} – {format(inv.periodEnd, "MMM d, yyyy")}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(inv.dueDate, "MMM d, yyyy")}
                    </td>
                    <td className="px-4 py-3">{formatMoney(inv.amount, locale)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          INVOICE_STATUS_STYLES[inv.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {tb(`status.${inv.status}`)}
                      </span>
                    </td>
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
