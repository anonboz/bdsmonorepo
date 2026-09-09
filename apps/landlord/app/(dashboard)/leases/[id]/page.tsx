import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getSession } from "@/lib/session";
import { listLeaseInspections } from "@/services/inspection.service";
import { getLease } from "@/services/lease.service";
import type { OrgRole } from "@repo/db";
import { formatMoney } from "@repo/shared";
import { buttonVariants, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";

import { InspectionManager } from "./inspection-manager";

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

const EDIT_ROLES: readonly OrgRole[] = ["owner", "landlord", "agent"];

export default async function LeaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let lease: Awaited<ReturnType<typeof getLease>>;
  try {
    lease = await getLease(session, id);
  } catch {
    notFound();
  }
  const inspections = await listLeaseInspections(session, lease.id);
  const canEdit = EDIT_ROLES.includes(session.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <Link
          href="/leases"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " -ml-2"}
        >
          <ArrowLeft className="size-4" />
          Back to leases
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
          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
            STATUS_STYLES[lease.status] ?? "bg-muted text-muted-foreground"
          }`}
        >
          {lease.status}
        </span>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lease terms</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Term</dt>
              <dd>
                {format(lease.startDate, "MMM d, yyyy")} – {format(lease.endDate, "MMM d, yyyy")}
              </dd>
              <dt className="text-muted-foreground">Monthly rent</dt>
              <dd>{formatMoney(lease.rentAmount)}</dd>
              <dt className="text-muted-foreground">Deposit</dt>
              <dd>{formatMoney(lease.depositAmount)}</dd>
              <dt className="text-muted-foreground">Rent due</dt>
              <dd>Day {lease.rentDueDay} of each month</dd>
              <dt className="text-muted-foreground">Signed</dt>
              <dd>{lease.signedAt ? format(lease.signedAt, "MMM d, yyyy") : "Not signed yet"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Tenants ({lease.tenancies.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {lease.tenancies.map((t) => (
                <li key={t.userId} className="flex items-center justify-between gap-3">
                  <span>
                    <span className="font-medium">{t.user.name ?? t.user.email}</span>
                    {t.user.name && (
                      <span className="block text-xs text-muted-foreground">{t.user.email}</span>
                    )}
                  </span>
                  {t.isPrimary && (
                    <span className="inline-flex rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                      Primary
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <InspectionManager leaseId={lease.id} initialInspections={inspections} canEdit={canEdit} />

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Invoices</h2>
        {lease.invoices.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              No invoices on this lease yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Period</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium">Amount</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lease.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="px-4 py-3">
                        {format(inv.periodStart, "MMM d")} – {format(inv.periodEnd, "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {format(inv.dueDate, "MMM d, yyyy")}
                      </td>
                      <td className="px-4 py-3">{formatMoney(inv.amount)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            INVOICE_STATUS_STYLES[inv.status] ?? "bg-muted text-muted-foreground"
                          }`}
                        >
                          {inv.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
