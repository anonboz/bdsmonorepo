import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export async function generateMetadata() {
  const t = await getTranslations('tenant.bills.paymentCancelled');
  return { title: t('metadataTitle') };
}

export default async function PaymentCancelledPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const t = await getTranslations('tenant.bills.paymentCancelled');

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t('body')}</CardContent>
      </Card>

      <div className="flex gap-2">
        <Button asChild>
          <Link href={`/my-bills/${billId}`}>{t('backToBill')}</Link>
        </Button>
      </div>
    </main>
  );
}
