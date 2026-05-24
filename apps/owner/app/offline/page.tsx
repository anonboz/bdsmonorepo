'use client';

import { useTranslations } from 'next-intl';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

export default function OfflinePage() {
  const t = useTranslations('owner.offline');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
