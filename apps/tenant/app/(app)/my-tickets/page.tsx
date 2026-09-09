import { format } from "date-fns";

import { getTranslations } from "@/i18n/server";
import { getSession } from "@/lib/session";
import { listMyLeases } from "@/services/lease.service";
import { listMyTickets } from "@/services/ticket.service";
import { Card, CardContent } from "@repo/ui";
import { NewTicketForm } from "./new-ticket-form";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-primary/15 text-primary",
  triaged: "bg-secondary text-secondary-foreground",
  assigned: "bg-accent/15 text-accent-foreground",
  in_progress: "bg-primary/15 text-primary",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-secondary text-secondary-foreground",
  high: "bg-accent/15 text-accent-foreground",
  emergency: "bg-destructive/15 text-destructive",
};

export default async function MyTicketsPage() {
  const session = await getSession();
  const [{ rows, open }, { rows: leases }] = await Promise.all([
    listMyTickets(session),
    listMyLeases(session),
  ]);
  const t = await getTranslations("tickets");
  // Only current leases can have requests raised against them.
  const leaseOptions = leases
    .filter((l) => l.status === "active" || l.status === "draft")
    .map((l) => ({ id: l.id, label: `${l.unit.property.name} · ${l.unit.label}` }));

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
          {open > 0 && (
            <p className="text-sm font-medium text-primary">{t("openCount", { count: open })}</p>
          )}
        </div>
      </header>

      <NewTicketForm leases={leaseOptions} />

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
                  <th className="px-4 py-3 font-medium">{t("colRequest")}</th>
                  <th className="px-4 py-3 font-medium">{t("colProperty")}</th>
                  <th className="px-4 py-3 font-medium">{t("colPriority")}</th>
                  <th className="px-4 py-3 font-medium">{t("colStatus")}</th>
                  <th className="px-4 py-3 font-medium">{t("colReported")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ticket) => (
                  <tr key={ticket.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{ticket.title}</span>
                      {ticket.description && (
                        <span className="block max-w-xs truncate text-xs text-muted-foreground">
                          {ticket.description}
                        </span>
                      )}
                      {ticket.vendorName && ticket.scheduledAt && (
                        <span className="block text-xs text-muted-foreground">
                          {t("assigned", {
                            vendor: ticket.vendorName,
                            date: format(ticket.scheduledAt, "MMM d, yyyy"),
                          })}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{ticket.property}</span>
                      <span className="text-muted-foreground"> · {ticket.unitLabel}</span>
                      <span className="block text-xs text-muted-foreground">{ticket.city}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          PRIORITY_STYLES[ticket.priority] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {t(`priority.${ticket.priority}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[ticket.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {t(`status.${ticket.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(ticket.createdAt, "MMM d, yyyy")}
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
