import { getSession, requireAdmin } from "@/lib/session";
import { listOrganizations } from "@/services/admin.service";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const session = await getSession();
  requireAdmin(session);
  const { rows, total } = await listOrganizations(session, {});

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Organizations</h1>
        <p className="text-muted-foreground">{total} organization(s) on the platform.</p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No organizations yet.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Properties</th>
                  <th className="px-4 py-3 font-medium">Leases</th>
                  <th className="px-4 py-3 font-medium">Members</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((org) => (
                  <tr key={org.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{org.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{org.slug}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          org.active
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {org.active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{org._count.properties}</td>
                    <td className="px-4 py-3 text-muted-foreground">{org._count.leases}</td>
                    <td className="px-4 py-3 text-muted-foreground">{org._count.memberships}</td>
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
