import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { defaultLocale, type Locale } from '@repo/i18n';
import { Button } from '@repo/ui';

import { LanguageCard } from './_components/language-card';
import { SignOutButton } from './_components/sign-out-button';
import { getSession } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.me');
  return { title: t('metadataTitle') };
}

export default async function OwnerAccountPage() {
  const t = await getTranslations('owner.me');
  const tChrome = await getTranslations('owner.chrome');
  const session = await getSession();
  const currentLocale: Locale = session?.user.locale ?? defaultLocale;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{tChrome('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <LanguageCard current={currentLocale} />
      <SignOutButton />
    </main>
  );
}
