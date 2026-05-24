import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

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

  if (lease.status !== 'DRAFT') {
    redirect(`/houses/${houseId}/units/${unitId}/leases/${leaseId}`);
  }

  const tenantEmail = fetchTenantEmail(lease.tenantId);
  const t = await getTranslations('owner.leases');
  const tForm = await getTranslations('owner.leases.form');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}/leases/${leaseId}`}>{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tForm('editTitle')}</h1>
        <p className="text-sm text-muted-foreground">{tForm('editSubtitle')}</p>
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
  return null;
}
