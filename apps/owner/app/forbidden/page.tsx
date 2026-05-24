import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { APP_NAME, APP_ROLE } from '../../lib/app-config';

export default async function ForbiddenPage() {
  const t = await getTranslations('owner.forbidden');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t('description', { role: APP_ROLE, appName: APP_NAME })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">{t('signInDifferent')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
