import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { PartnerSummary } from '@repo/shared';
import { Button } from '@repo/ui';

import { BookForm } from './book-form';
import { ApiError } from '../../../../../lib/api';
import { serverApi } from '../../../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.partners.book');
  return { title: t('metadataTitle') };
}

export default async function BookPartnerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fromTicket?: string }>;
}) {
  const [{ id }, { fromTicket }] = await Promise.all([params, searchParams]);
  const partner = await fetchPartner(id);
  if (!partner) notFound();

  const backHref = fromTicket ? `/tickets/${fromTicket}` : `/partners/${id}`;
  const t = await getTranslations('owner.partners.book');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={backHref}>{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title', { name: partner.businessName })}</h1>
        <p className="text-sm text-muted-foreground">
          {fromTicket ? t('subtitleFromTicket') : t('subtitle')}
        </p>
      </div>

      <BookForm partner={partner} ticketId={fromTicket} />
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
