import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export async function generateMetadata() {
  const t = await getTranslations('tenant.bills.paymentSuccess');
  return { title: t('metadataTitle') };
}

export default async function PaymentSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { billId } = await params;
  const { session_id } = await searchParams;
  const t = await getTranslations('tenant.bills.paymentSuccess');

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>
            {t.rich('description', { strong: (chunks) => <strong>{chunks}</strong> })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {session_id && (
            <p>
              <span className="font-medium text-foreground">{t('stripeReferenceLabel')}</span>{' '}
              <code className="text-xs">{session_id}</code>
            </p>
          )}
          <p>{t('stillOutstanding')}</p>
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
