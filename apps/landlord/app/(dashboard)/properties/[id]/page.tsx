import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BedDouble, Bath } from "lucide-react";

import { formatMoney } from "@repo/shared";
import { getSession } from "@/lib/session";
import { getProperty } from "@/services/property.service";
import { buttonVariants, Card, CardContent } from "@repo/ui";

import { ListingCreateForm } from "./listing-create-form";
import { UnitForm } from "./unit-form";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<string, string> = {
  apartment: "Apartment",
  house: "House",
  condo: "Condo",
  townhouse: "Townhouse",
  room: "Room",
  commercial: "Commercial",
};

const UNIT_STATUS_LABELS: Record<string, string> = {
  available: "Available",
  occupied: "Occupied",
  maintenance: "Maintenance",
  offline: "Offline",
};

export default async function PropertyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let property: Awaited<ReturnType<typeof getProperty>>;
  try {
    property = await getProperty(session, id);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <Link
          href="/properties"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " -ml-2"}
        >
          <ArrowLeft className="size-4" />
          Back to properties
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{property.name}</h1>
        <p className="text-muted-foreground">
          {TYPE_LABELS[property.type] ?? property.type} · {property.addressLine1}, {property.city}
          {property.region ? `, ${property.region}` : ""}
        </p>
      </header>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Units ({property.units.length})</h2>
        <UnitForm propertyId={property.id} />
      </div>

      {property.units.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No units yet. Add one to start creating listings.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {property.units.map((unit) => (
            <Card key={unit.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-medium">{unit.label}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <BedDouble className="size-4" />
                        {unit.bedrooms} bd
                      </span>
                      <span className="flex items-center gap-1">
                        <Bath className="size-4" />
                        {unit.bathrooms} ba
                      </span>
                      <span>{formatMoney(unit.rentAmount)}/mo</span>
                      <span>{UNIT_STATUS_LABELS[unit.status] ?? unit.status}</span>
                    </div>
                  </div>
                  <Link
                    href={`/listings`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View listings
                  </Link>
                </div>
                <ListingCreateForm unitId={unit.id} unitRentAmount={unit.rentAmount} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
