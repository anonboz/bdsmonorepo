import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { KycStatus, PartnerSummary } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

const KYC_PALETTE: Record<KycStatus, string> = {
  NONE: 'bg-zinc-100 text-zinc-700',
  PENDING: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
};

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const partner = await fetchPartner(id);
  if (!partner) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/partners">← Back to partners</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{partner.businessName}</h1>
            <p className="text-sm text-muted-foreground">
              <span
                className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${KYC_PALETTE[partner.kycStatus]}`}
              >
                KYC {partner.kycStatus.toLowerCase()}
              </span>
              {partner.serviceArea ?? ''}
            </p>
          </div>
        </div>
      </div>

      {partner.bio && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{partner.bio}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Services</CardTitle>
          <CardDescription>
            {partner.activeServices.length === 0
              ? 'No active services.'
              : `${partner.activeServices.length} bookable service${partner.activeServices.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        {partner.activeServices.length > 0 && (
          <CardContent>
            <ul className="space-y-2">
              {partner.activeServices.map((s) => (
                <li key={s.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold">{s.name}</p>
                    <p className="font-medium tabular-nums">
                      {formatMoney(s.basePrice, s.currency)}
                    </p>
                  </div>
                  {s.description && (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Book</CardTitle>
          <CardDescription>Direct booking lands in 5.2.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

async function fetchPartner(id: string): Promise<PartnerSummary | null> {
  try {
    return await serverApi<PartnerSummary>(`/v1/partners/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
