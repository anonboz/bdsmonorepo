import { getSession } from "@/lib/session";
import { listApplications } from "@/services/application.service";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  submitted: "bg-secondary text-secondary-foreground",
  screening: "bg-accent/15 text-accent-foreground",
  approved: "bg-primary/15 text-primary",
  rejected: "bg-destructive/15 text-destructive",
  withdrawn: "bg-muted text-muted-foreground",
};

export default async function ApplicationsPage() {
  const session = await getSession();
  const { rows, total } = await listApplications(session, {});

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Applications</h1>
        <p className="text-muted-foreground">{total} application(s) in this organization.</p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No applications yet. They&apos;ll appear here as prospects apply to your listings.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Applicant</th>
                  <th className="px-4 py-3 font-medium">Listing</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((application) => (
                  <tr key={application.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium">{application.applicant.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {application.applicant.email}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{application.listing.title}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {application.listing.unit.property.name} ·{" "}
                        {application.listing.unit.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                          STATUS_STYLES[application.status] ?? "bg-muted text-muted-foreground"
                        }`}
                      >
                        {application.status}
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
