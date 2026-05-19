import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type { Lease } from '@repo/shared';
import { Button } from '@repo/ui';

import { ApiError } from '../../../../../../../../../lib/api';
import { serverApi } from '../../../../../../../../../lib/session';
import { LeaseForm } from '../../_components/lease-form';

export default async function EditLeasePage({
  params,
}: {
  params: Promise<{ id: string; unitId: string; leaseId: string }>;
}) {
  const { id: houseId, unitId, leaseId } = await params;
  const lease = await fetchLease(houseId, unitId, leaseId);
  if (!lease) notFound();

  // Hard-redirect rather than rendering a disabled form — the API would
  // refuse the PATCH and the user would be stuck with a stale UI.
  if (lease.status !== 'DRAFT') {
    redirect(`/houses/${houseId}/units/${unitId}/leases/${leaseId}`);
  }

  // Resolve the tenant's email so the form's lookup picker can pre-populate
  // without the owner having to re-enter it. Falls back to null today —
  // GET-user-by-id endpoint lands in a later slice.
  const tenantEmail = fetchTenantEmail(lease.tenantId);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}/leases/${leaseId}`}>← Back to lease</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Edit lease</h1>
        <p className="text-sm text-muted-foreground">
          DRAFT leases can be edited freely. Once activated the lease is locked.
        </p>
      </div>
      <LeaseForm
        houseId={houseId}
        unitId={unitId}
        initial={lease}
        initialTenantEmail={tenantEmail ?? undefined}
      />
    </main>
  );
}

async function fetchLease(houseId: string, unitId: string, leaseId: string): Promise<Lease | null> {
  try {
    return await serverApi<Lease>(`/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

function fetchTenantEmail(_tenantId: string): string | null {
  // No GET-user-by-id endpoint yet (out of scope for this slice). The form
  // works without a pre-populated email — the owner just retypes it.
  return null;
}
