import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { House } from '@repo/shared';
import { Button } from '@repo/ui';

import { ApiError } from '../../../../../../lib/api';
import { serverApi } from '../../../../../../lib/session';
import { UnitForm } from '../_components/unit-form';

export const metadata = { title: 'New unit' };

export default async function NewUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: houseId } = await params;
  const house = await fetchHouse(houseId);
  if (!house) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units`}>← Back to units</Link>
        </Button>
        <h1 className="text-2xl font-semibold">New unit in {house.name}</h1>
      </div>
      <UnitForm houseId={houseId} />
    </main>
  );
}

async function fetchHouse(id: string): Promise<House | null> {
  try {
    return await serverApi<House>(`/v1/houses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
