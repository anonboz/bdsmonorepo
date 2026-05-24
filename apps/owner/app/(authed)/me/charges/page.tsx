import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { JobLedgerEntry, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.charges');
  return { title: t('metadataTitle') };
}

export default async function MyChargesPage() {
  const page = await serverApi<Page<JobLedgerEntry>>('/v1/me/charges?limit=50');
  const t = await getTranslations('owner.charges');
  const tChrome = await getTranslations('owner.chrome');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{tChrome('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('tableJob')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('tableAmount')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableRecorded')}</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3 text-xs">
                      <Link href={`/me/service-jobs/${e.jobId}`} className="underline">
                        {e.jobId.slice(-8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-rose-700">
                      {formatMoney(e.amount, e.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
