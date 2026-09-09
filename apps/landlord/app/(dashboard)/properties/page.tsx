import Link from "next/link";

import { getSession } from "@/lib/session";
import { listProperties } from "@/services/property.service";
import { Card, CardContent } from "@repo/ui";

import { PropertyForm } from "./property-form";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhouse: "Townhouse",
  room: "Room",
  commercial: "Commercial",
};

export default async function PropertiesPage() {
  const session = await getSession();
  const { rows, total } = await listProperties(session, {});

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Properties</h1>
          <p className="text-muted-foreground">{total} property(ies) in this organization.</p>
        </div>
      </header>

      <PropertyForm />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No properties yet. Add one to start listing units and leases.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Units</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((property) => (
                  <tr key={property.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/properties/${property.id}`} className="hover:underline">
                        {property.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {TYPE_LABELS[property.type] ?? property.type}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {property.city}
                      {property.region ? `, ${property.region}` : ""}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{property._count.units}</td>
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
