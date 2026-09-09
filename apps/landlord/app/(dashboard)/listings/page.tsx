import Link from "next/link";

import { getSession } from "@/lib/session";
import { listOrgListings } from "@/services/listing.service";
import { Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  paused: "Paused",
  rented: "Rented",
  archived: "Archived",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  published: "bg-primary/10 text-primary",
  paused: "bg-accent/10 text-accent",
  rented: "bg-secondary text-secondary-foreground",
  archived: "bg-muted text-muted-foreground/70",
};

export default async function ListingsPage() {
  const session = await getSession();
  const rows = await listOrgListings(session);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Listings</h1>
        <p className="text-muted-foreground">
          {rows.length} listing{rows.length === 1 ? "" : "s"} in this organization.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No listings yet. Create one from a unit on its property's page.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Unit</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Photos</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((listing) => (
                  <tr key={listing.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/listings/${listing.id}`} className="hover:underline">
                        {listing.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {listing.propertyName} · {listing.unitLabel}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[listing.status] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {STATUS_LABELS[listing.status] ?? listing.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{listing.photoCount}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/listings/${listing.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Edit
                        </Link>
                        <Link
                          href={`/listings/${listing.id}/photos`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Photos
                        </Link>
                      </div>
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
