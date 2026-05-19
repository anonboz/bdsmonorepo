import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { House, Page, Unit, UnitStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../../lib/api';
import { serverApi } from '../../../../../lib/session';

export const metadata = { title: 'Units' };

export default async function UnitsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: houseId } = await params;
  const [house, page] = await Promise.all([fetchHouse(houseId), fetchUnits(houseId)]);
  if (!house) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}`}>← Back to {house.name}</Link>
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Units</h1>
            <p className="text-sm text-muted-foreground">
              {page.items.length} {page.items.length === 1 ? 'unit' : 'units'} in {house.name}
            </p>
          </div>
          <Button asChild>
            <Link href={`/houses/${houseId}/units/new`}>New unit</Link>
          </Button>
        </div>
      </div>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No units yet</CardTitle>
            <CardDescription>Add the first rentable unit to this house.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/houses/${houseId}/units/new`}>Create one</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {page.items.map((unit) => (
            <UnitCard key={unit.id} houseId={houseId} unit={unit} />
          ))}
        </ul>
      )}
    </main>
  );
}

function UnitCard({ houseId, unit }: { houseId: string; unit: Unit }) {
  return (
    <li>
      <Link
        href={`/houses/${houseId}/units/${unit.id}`}
        className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold leading-tight">{unit.label}</h2>
            <StatusBadge status={unit.status} />
          </div>
          <p className="text-xs text-muted-foreground">{formatStats(unit)}</p>
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: UnitStatus }) {
  const palette: Record<UnitStatus, string> = {
    VACANT: 'bg-emerald-100 text-emerald-900',
    OCCUPIED: 'bg-blue-100 text-blue-900',
    MAINTENANCE: 'bg-amber-100 text-amber-900',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}

function formatStats(unit: Unit): string {
  const parts: string[] = [];
  if (unit.bedrooms != null) parts.push(`${unit.bedrooms}bd`);
  if (unit.bathrooms != null) parts.push(`${unit.bathrooms}ba`);
  if (unit.sqm != null) parts.push(`${unit.sqm}m²`);
  if (unit.floor != null) parts.push(`floor ${unit.floor}`);
  return parts.length > 0 ? parts.join(' · ') : 'No stats yet';
}

async function fetchHouse(id: string): Promise<House | null> {
  try {
    return await serverApi<House>(`/v1/houses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchUnits(houseId: string): Promise<Page<Unit>> {
  return serverApi<Page<Unit>>(`/v1/houses/${houseId}/units?limit=50`);
}
