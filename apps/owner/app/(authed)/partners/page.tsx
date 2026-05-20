import Link from 'next/link';

import type { KycStatus, Page, PartnerSummary } from '@repo/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Partners' };

type SearchParams = Promise<{ q?: string }>;

const KYC_PALETTE: Record<KycStatus, string> = {
  NONE: 'bg-zinc-100 text-zinc-700',
  PENDING: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
};

export default async function PartnersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '20' });
  if (sp.q) qs.set('q', sp.q);

  const page = await serverApi<Page<PartnerSummary>>(`/v1/partners?${qs}`);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Partners</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0
            ? 'No partners match.'
            : `${page.items.length} matching · filter via ?q=`}
        </p>
      </header>

      <form className="grid gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search business name or service area"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
      </form>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>
              Loosen the filter or check back as more partners onboard.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/partners/${p.id}`}
                className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold">{p.businessName}</p>
                    {p.serviceArea && (
                      <p className="text-xs text-muted-foreground">{p.serviceArea}</p>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${KYC_PALETTE[p.kycStatus]}`}
                  >
                    KYC {p.kycStatus.toLowerCase()}
                  </span>
                </div>
                {p.activeServices.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {p.activeServices.length} service
                    {p.activeServices.length === 1 ? '' : 's'} · from{' '}
                    {formatMoney(
                      Math.min(...p.activeServices.map((s) => s.basePrice)),
                      p.activeServices[0]!.currency,
                    )}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
