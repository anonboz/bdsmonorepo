import { getSession } from "@/lib/session";
import { listWorkOrders } from "@/services/work-order.service";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-secondary text-secondary-foreground",
  scheduled: "bg-accent/15 text-accent-foreground",
  in_progress: "bg-primary/15 text-primary",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/15 text-destructive",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default async function WorkOrdersPage() {
  const session = await getSession();
  const { rows, total } = await listWorkOrders(session, {});

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Work orders</h1>
        <p className="text-muted-foreground">{total} work order(s) in this organization.</p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No work orders yet. New jobs will appear here once assigned.
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
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((workOrder) => (
                  <tr key={workOrder.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{workOrder.request.title}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{workOrder.request.unit.property.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {workOrder.request.unit.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {workOrder.request.priority}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[workOrder.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {STATUS_LABELS[workOrder.status] ?? workOrder.status}
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
