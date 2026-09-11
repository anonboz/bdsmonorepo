import { format } from "date-fns";

import { getSession } from "@/lib/session";
import { listOrgMaintenanceRequests } from "@/services/maintenance.service";
import type { OrgRole } from "@repo/db";
import { Card, CardContent } from "@repo/ui";

import { StatusSelect } from "../_components/status-select";

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

const EDIT_ROLES: readonly OrgRole[] = ["owner", "landlord", "agent"];

// Mirrors the transition table in maintenance.service.
const NEXT: Record<string, readonly { value: string; label: string }[]> = {
  open: [
    { value: "triaged", label: "Triaged" },
    { value: "assigned", label: "Assigned" },
    { value: "in_progress", label: "In progress" },
    { value: "cancelled", label: "Cancelled" },
  ],
  triaged: [
    { value: "assigned", label: "Assigned" },
    { value: "in_progress", label: "In progress" },
    { value: "cancelled", label: "Cancelled" },
  ],
  assigned: [
    { value: "in_progress", label: "In progress" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
  in_progress: [
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ],
};

export default async function MaintenancePage() {
  const session = await getSession();
  const { rows, open } = await listOrgMaintenanceRequests(session);
  const canEdit = EDIT_ROLES.includes(session.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Maintenance</h1>
        <p className="text-muted-foreground">Requests raised by your tenants.</p>
        {open > 0 && <p className="text-sm font-medium text-primary">{open} open</p>}
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No maintenance requests yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Request</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Reported by</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Reported</th>
                  {canEdit && <th className="px-4 py-3 font-medium sr-only">Update</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{r.title}</span>
                      {r.description && (
                        <span className="block max-w-xs truncate text-xs text-muted-foreground">
                          {r.description}
                        </span>
                      )}
                      {r.vendorName && r.scheduledAt && (
                        <span className="block text-xs text-muted-foreground">
                          {r.vendorName} · {format(r.scheduledAt, "MMM d, yyyy")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{r.property}</span>
                      <span className="text-muted-foreground"> · {r.unitLabel}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.reportedBy}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          PRIORITY_STYLES[r.priority] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          STATUS_STYLES[r.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {r.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(r.createdAt, "MMM d, yyyy")}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3">
                        <StatusSelect
                          aria-label="Change request status"
                          endpoint={`/api/maintenance-requests/${r.id}`}
                          current={r.status}
                          options={NEXT[r.status] ?? []}
                        />
                      </td>
                    )}
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
