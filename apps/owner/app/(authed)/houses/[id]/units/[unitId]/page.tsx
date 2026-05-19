import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { House, Unit, UnitStatus } from '@repo/shared';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../../../lib/api';
import { serverApi } from '../../../../../../lib/session';
import { DeleteUnitButton } from '../_components/delete-unit-button';
import { LeaseListCard } from './leases/_components/lease-list-card';

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id: houseId, unitId } = await params;
  const [house, unit] = await Promise.all([fetchHouse(houseId), fetchUnit(houseId, unitId)]);
  if (!house || !unit) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units`}>← Back to units</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{unit.label}</h1>
            <p className="text-sm text-muted-foreground">
              {house.name} · <StatusLabel status={unit.status} />
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/houses/${houseId}/units/${unit.id}/edit`}>Edit</Link>
            </Button>
            <DeleteUnitButton houseId={houseId} unitId={unit.id} unitLabel={unit.label} />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat label="Bedrooms" value={unit.bedrooms} />
            <Stat label="Bathrooms" value={unit.bathrooms} />
            <Stat label="Size" value={unit.sqm != null ? `${unit.sqm} m²` : null} />
            <Stat label="Floor" value={unit.floor} />
          </dl>
        </CardContent>
      </Card>

      <LeaseListCard houseId={houseId} unitId={unitId} />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value ?? '—'}</dd>
    </div>
  );
}

function StatusLabel({ status }: { status: UnitStatus }) {
  return <span>{status[0] + status.slice(1).toLowerCase()}</span>;
}

async function fetchHouse(id: string): Promise<House | null> {
  try {
    return await serverApi<House>(`/v1/houses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchUnit(houseId: string, unitId: string): Promise<Unit | null> {
  try {
    return await serverApi<Unit>(`/v1/houses/${houseId}/units/${unitId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
