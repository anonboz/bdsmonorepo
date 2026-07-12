import Link from "next/link";
import { BedDouble, Bath, MapPin } from "lucide-react";

import { listPublicListings } from "@/services/listing.service";
import { formatMoney } from "@repo/shared";
import { buttonVariants, Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { rows, total } = await listPublicListings({});

  return (
    <div className="min-h-dvh">
      {/* Marketing hero */}
      <section className="bg-primary/5 border-b">
        <div className="mx-auto max-w-5xl px-6 py-16 text-center sm:py-24">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Find your next home</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Browse {total} published rental{total === 1 ? "" : "s"} across every city. No account
            needed — just find the place that fits.
          </p>
        </div>
      </section>

      {/* Listings grid */}
      <section className="mx-auto max-w-5xl px-6 py-10">
        <h2 className="mb-6 text-2xl font-semibold">Available now</h2>

        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No listings are available right now. Please check back soon.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((listing) => (
              <Card key={listing.id} className="flex flex-col overflow-hidden">
                <CardContent className="flex flex-1 flex-col gap-3 p-5">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold leading-tight">
                      {listing.unit.property.name}
                      <span className="text-muted-foreground"> · {listing.unit.label}</span>
                    </h3>
                    <p className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="size-4" />
                      {listing.unit.property.city}
                      {listing.unit.property.region ? `, ${listing.unit.property.region}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <BedDouble className="size-4" />
                      {listing.unit.bedrooms} bd
                    </span>
                    <span className="flex items-center gap-1">
                      <Bath className="size-4" />
                      {listing.unit.bathrooms} ba
                    </span>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="text-lg font-semibold">
                      {formatMoney(listing.rentAmount)}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </span>
                    <Link
                      href={`/listings/${listing.id}`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      View
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
