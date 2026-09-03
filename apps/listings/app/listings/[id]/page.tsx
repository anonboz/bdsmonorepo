import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BedDouble, Bath, MapPin } from "lucide-react";

import { getPublicListing } from "@/services/listing.service";
import { formatMoney } from "@repo/shared";
import { buttonVariants, Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let listing: Awaited<ReturnType<typeof getPublicListing>>;
  try {
    listing = await getPublicListing(id);
  } catch {
    notFound();
  }

  const { unit } = listing;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <Link href="/" className={buttonVariants({ variant: "ghost", size: "sm" }) + " mb-6 -ml-2"}>
        <ArrowLeft className="size-4" />
        Back to listings
      </Link>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {unit.property.name}
          <span className="text-muted-foreground"> · {unit.label}</span>
        </h1>
        <p className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="size-4 shrink-0" />
          {unit.property.city}
          {unit.property.region ? `, ${unit.property.region}` : ""}
        </p>
      </div>

      {listing.photos.length > 0 ? (
        <div className="mt-6 flex gap-3 overflow-x-auto">
          {listing.photos.map((photo) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={photo.id}
              src={photo.url}
              alt={unit.property.name}
              className="aspect-video w-64 shrink-0 rounded-md border object-cover"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        <span className="flex items-center gap-1">
          <BedDouble className="size-4" />
          {unit.bedrooms} bedroom{unit.bedrooms === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1">
          <Bath className="size-4" />
          {unit.bathrooms} bathroom{unit.bathrooms === 1 ? "" : "s"}
        </span>
      </div>

      <Card className="mt-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-5 sm:p-6">
          <span className="text-2xl font-semibold">
            {formatMoney(listing.rentAmount)}
            <span className="text-base font-normal text-muted-foreground">/mo</span>
          </span>
          <span className="text-sm text-muted-foreground">
            Deposit {formatMoney(listing.depositAmount)}
          </span>
        </CardContent>
      </Card>

      {listing.title ? <h2 className="mt-8 text-xl font-semibold">{listing.title}</h2> : null}

      {listing.description ? (
        <p className="mt-3 whitespace-pre-line text-muted-foreground">{listing.description}</p>
      ) : (
        <p className="mt-3 text-muted-foreground">No description provided.</p>
      )}
    </div>
  );
}
