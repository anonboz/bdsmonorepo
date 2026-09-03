import Link from "next/link";
import { BedDouble, Bath, ImageOff, MapPin } from "lucide-react";

import { listPublicListings } from "@/services/listing.service";
import { formatMoney, parseMoneyToCents } from "@repo/shared";
import { buttonVariants, Card, CardContent } from "@repo/ui";

export const dynamic = "force-dynamic";

const TAKE = 24;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
] as const;
type SortValue = (typeof SORT_OPTIONS)[number]["value"];

const INPUT_CLASS =
  "h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// searchParams values on this page are UI-facing (city text, rent typed in
// major units e.g. "5000000") — distinct from /api/listings' own query
// contract, which takes rentAmount in cents directly. Converted below before
// calling the service.
type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

function toCentsOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const cents = parseMoneyToCents(value);
    return Number.isFinite(cents) && cents >= 0 ? cents : undefined;
  } catch {
    return undefined; // bad manual query-string edit — ignore rather than 500
  }
}

function isSortValue(value: string | undefined): value is SortValue {
  return SORT_OPTIONS.some((opt) => opt.value === value);
}

/** Builds an href back to "/" carrying the given filters + overrides. */
function buildHref(
  filters: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...overrides })) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;

  const city = firstValue(raw.city);
  const minRentInput = firstValue(raw.minRent);
  const maxRentInput = firstValue(raw.maxRent);
  const sort = isSortValue(firstValue(raw.sort)) ? (firstValue(raw.sort) as SortValue) : "newest";
  const skipInput = firstValue(raw.skip);
  const skip = skipInput && /^\d+$/.test(skipInput) ? Number.parseInt(skipInput, 10) : 0;

  const minRent = toCentsOrUndefined(minRentInput);
  const maxRent = toCentsOrUndefined(maxRentInput);

  const { rows, total } = await listPublicListings({
    city,
    minRent,
    maxRent,
    sort,
    take: TAKE,
    skip,
  });

  const hasFilters = Boolean(city || minRentInput || maxRentInput || sort !== "newest");

  // Filters carried across pagination links (not skip — each link sets its own).
  const filterParams = { city, minRent: minRentInput, maxRent: maxRentInput, sort };
  const hasPrev = skip > 0;
  const hasNext = skip + TAKE < total;
  const rangeStart = total === 0 ? 0 : skip + 1;
  const rangeEnd = Math.min(skip + TAKE, total);

  return (
    <div className="min-h-dvh">
      {/* Marketing hero */}
      <section className="border-b bg-primary/5">
        <div className="mx-auto max-w-5xl px-4 py-12 text-center sm:px-6 sm:py-24">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Find your next home</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Browse {total} published rental{total === 1 ? "" : "s"} across every city. No account
            needed — just find the place that fits.
          </p>
        </div>
      </section>

      {/* Filters */}
      <section className="border-b bg-background">
        <form
          method="GET"
          action="/"
          className="mx-auto grid max-w-5xl grid-cols-1 gap-3 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]"
        >
          <input
            type="text"
            name="city"
            defaultValue={city ?? ""}
            placeholder="City"
            aria-label="City"
            className={INPUT_CLASS}
          />
          <input
            type="number"
            name="minRent"
            defaultValue={minRentInput ?? ""}
            placeholder="Min rent"
            aria-label="Minimum rent"
            min={0}
            step="any"
            inputMode="decimal"
            className={INPUT_CLASS}
          />
          <input
            type="number"
            name="maxRent"
            defaultValue={maxRentInput ?? ""}
            placeholder="Max rent"
            aria-label="Maximum rent"
            min={0}
            step="any"
            inputMode="decimal"
            className={INPUT_CLASS}
          />
          <select name="sort" defaultValue={sort} aria-label="Sort by" className={INPUT_CLASS}>
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className={buttonVariants({ size: "default" }) + " flex-1 sm:flex-none"}
            >
              Search
            </button>
            {hasFilters ? (
              <Link href="/" className={buttonVariants({ variant: "ghost", size: "default" })}>
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      {/* Listings grid */}
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-2xl font-semibold">Available now</h2>
          {total > 0 ? (
            <p className="text-sm text-muted-foreground">
              Showing {rangeStart}–{rangeEnd} of {total}
            </p>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {hasFilters
                ? "No listings match your filters. Try widening your search."
                : "No listings are available right now. Please check back soon."}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((listing) => (
              <Card key={listing.id} className="flex flex-col overflow-hidden">
                <div className="flex aspect-[4/3] w-full items-center justify-center bg-muted">
                  {listing.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={listing.photos[0].url}
                      alt={listing.unit.property.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ImageOff className="size-8 text-muted-foreground/40" />
                  )}
                </div>
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

        {/* Pagination */}
        {total > TAKE ? (
          <div className="mt-8 flex items-center justify-center gap-3">
            {hasPrev ? (
              <Link
                href={buildHref(filterParams, { skip: String(Math.max(skip - TAKE, 0)) })}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Previous
              </Link>
            ) : (
              <span
                className={
                  buttonVariants({ variant: "outline", size: "sm" }) +
                  " pointer-events-none opacity-50"
                }
              >
                Previous
              </span>
            )}
            {hasNext ? (
              <Link
                href={buildHref(filterParams, { skip: String(skip + TAKE) })}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Next
              </Link>
            ) : (
              <span
                className={
                  buttonVariants({ variant: "outline", size: "sm" }) +
                  " pointer-events-none opacity-50"
                }
              >
                Next
              </span>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
