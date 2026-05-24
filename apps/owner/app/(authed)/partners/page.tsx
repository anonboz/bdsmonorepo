import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { KycStatus, Page, PartnerSummary } from '@repo/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.partners');
  return { title: t('metadataTitle') };
}

type SearchParams = Promise<{ q?: string; fromTicket?: string }>;

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
  const fromTicket = sp.fromTicket;
  const detailHref = (id: string): string =>
    fromTicket ? `/partners/${id}?fromTicket=${fromTicket}` : `/partners/${id}`;

  const t = await getTranslations('owner.partners');
  const fmt = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {fromTicket
            ? t('fromTicketSubtitle')
            : page.items.length === 0
              ? t('summaryEmpty')
              : t('summaryCount', { count: page.items.length })}
        </p>
      </header>

      <form className="grid gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder={t('searchPlaceholder')}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        {fromTicket && <input type="hidden" name="fromTicket" value={fromTicket} />}
      </form>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((p) => (
            <PartnerRow key={p.id} partner={p} href={detailHref(p.id)} fmt={fmt} />
          ))}
        </ul>
      )}
    </main>
  );
}

function PartnerRow({
  partner,
  href,
  fmt,
}: {
  partner: PartnerSummary;
  href: string;
  fmt: Formatters;
}) {
  const t = useTranslations('owner.partners');
  const tKyc = useTranslations('owner.statuses.kycLower');
  return (
    <li>
      <Link
        href={href}
        className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold">{partner.businessName}</p>
            {partner.serviceArea && (
              <p className="text-xs text-muted-foreground">{partner.serviceArea}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {partner.ratingAverage !== null
                ? t('ratingSummary', {
                    avg: partner.ratingAverage.toFixed(1),
                    count: partner.ratingCount,
                  })
                : t('noRatings')}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${KYC_PALETTE[partner.kycStatus]}`}
          >
            {t('kycLabel', { status: tKyc(partner.kycStatus) })}
          </span>
        </div>
        {partner.activeServices.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t('servicesSummary', {
              count: partner.activeServices.length,
              price: fmt.formatMoney(
                Math.min(...partner.activeServices.map((s) => s.basePrice)),
                partner.activeServices[0]!.currency,
              ),
            })}
          </p>
        )}
      </Link>
    </li>
  );
}
