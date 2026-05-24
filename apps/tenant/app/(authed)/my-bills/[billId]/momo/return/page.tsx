import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export async function generateMetadata() {
  const t = await getTranslations('tenant.bills.momoReturn');
  return { title: t('metadataTitle') };
}

/**
 * Browser landing page after MoMo's hosted checkout (Phase 12.1).
 * MoMo also fires a server-to-server IPN against
 * `/v1/webhooks/momo/ipn` — that's the only place we mutate DB
 * state. This page is cosmetic: it tells the tenant what MoMo's
 * `resultCode` was and links back to the bill so they can see the
 * updated state once the IPN lands (usually within seconds).
 */
export default async function MomoReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{
    resultCode?: string;
    orderId?: string;
    transId?: string;
    message?: string;
  }>;
}) {
  const { billId } = await params;
  const sp = await searchParams;
  const success = sp.resultCode === '0';
  const t = await getTranslations('tenant.bills.momoReturn');

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{success ? t('okTitle') : t('failTitle')}</CardTitle>
          <CardDescription>
            {success
              ? t('okDescription')
              : t('failDescription', { code: sp.resultCode ?? t('unknownCode') })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {sp.transId && (
            <p>
              <span className="font-medium text-foreground">{t('momoReferenceLabel')}</span>{' '}
              <code className="text-xs">{sp.transId}</code>
            </p>
          )}
          {sp.orderId && (
            <p>
              <span className="font-medium text-foreground">{t('ourReferenceLabel')}</span>{' '}
              <code className="text-xs">{sp.orderId}</code>
            </p>
          )}
          {success && <p>{t('stillOutstanding')}</p>}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild>
          <Link href={`/my-bills/${billId}`}>{t('backToBill')}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/my-bills">{t('allBills')}</Link>
        </Button>
      </div>
    </main>
  );
}
