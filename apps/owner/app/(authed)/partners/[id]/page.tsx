import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { getFormatters } from '@repo/i18n';
import type { KycStatus, PartnerSummary } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { serverApi } from '../../../../lib/session';

const KYC_PALETTE: Record<KycStatus, string> = {
  NONE: 'bg-zinc-100 text-zinc-700',
  PENDING: 'bg-amber-100 text-amber-900',
  APPROVED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
};

export default async function PartnerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fromTicket?: string }>;
}) {
  const [{ id }, { fromTicket }] = await Promise.all([params, searchParams]);
  const partner = await fetchPartner(id);
  if (!partner) notFound();
  const bookHref = fromTicket
    ? `/partners/${partner.id}/book?fromTicket=${fromTicket}`
    : `/partners/${partner.id}/book`;
  const backHref = fromTicket ? `/partners?fromTicket=${fromTicket}` : '/partners';

  const t = await getTranslations('owner.partners');
  const tDetail = await getTranslations('owner.partners.detail');
  const { formatMoney } = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={backHref}>{t('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{partner.businessName}</h1>
            <SubtitleLine partner={partner} />
          </div>
        </div>
      </div>

      {partner.bio && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('aboutTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{partner.bio}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('servicesTitle')}</CardTitle>
          <CardDescription>
            {partner.activeServices.length === 0
              ? tDetail('servicesEmpty')
              : tDetail('servicesCount', { count: partner.activeServices.length })}
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
          <CardTitle className="text-lg">{tDetail('bookTitle')}</CardTitle>
          <CardDescription>
            {fromTicket ? tDetail('bookDescriptionFromTicket') : tDetail('bookDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={bookHref}>{tDetail('bookButton')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function SubtitleLine({ partner }: { partner: PartnerSummary }) {
  const t = useTranslations('owner.partners');
  const tKyc = useTranslations('owner.statuses.kycLower');
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <span
          className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${KYC_PALETTE[partner.kycStatus]}`}
        >
          {t('kycLabel', { status: tKyc(partner.kycStatus) })}
        </span>
        {partner.serviceArea ?? ''}
      </p>
      <p className="text-xs text-muted-foreground">
        {partner.ratingAverage !== null
          ? t('ratingSummary', {
              avg: partner.ratingAverage.toFixed(1),
              count: partner.ratingCount,
            })
          : t('noRatings')}
      </p>
    </>
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
