import { format } from "date-fns";

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

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">My leases</h1>
        <p className="text-muted-foreground">You are on {total} lease(s).</p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            You&apos;re not on any leases yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Property</th>
                  <th className="px-4 py-3 font-medium">Term</th>
                  <th className="px-4 py-3 font-medium">Rent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
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
                    <td className="px-4 py-3">{formatMoney(lease.rentAmount)}/mo</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          STATUS_STYLES[lease.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {lease.status}
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
