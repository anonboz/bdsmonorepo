import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { getSession } from "@/lib/session";
import { getOrgListing } from "@/services/listing.service";
import { buttonVariants } from "@repo/ui";

import { ListingPhotosManager } from "./listing-photos-manager";

export const dynamic = "force-dynamic";

export default async function ListingPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let listing: Awaited<ReturnType<typeof getOrgListing>>;
  try {
    listing = await getOrgListing(session, id);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <Link
          href="/listings"
          className={buttonVariants({ variant: "ghost", size: "sm" }) + " -ml-2"}
        >
          <ArrowLeft className="size-4" />
          Back to listings
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{listing.title}</h1>
        <p className="text-muted-foreground">
          {listing.propertyName} · {listing.unitLabel}
        </p>
      </header>

      <ListingPhotosManager listingId={listing.id} initialPhotos={listing.photos} />
    </div>
  );
}
