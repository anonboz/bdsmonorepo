import { getTranslations } from 'next-intl/server';

import { defaultLocale, type Locale } from '@repo/i18n';

import { DeleteAccountCard } from './_components/delete-account-card';
import { LanguageCard } from './_components/language-card';
import { getSession } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.account');
  return { title: t('metadataTitle') };
}

export default async function AccountPage() {
  const t = await getTranslations('tenant.account');
  // (authed) layout guarantees a session; fall back to defaultLocale
  // for the type, never expected at runtime.
  const session = await getSession();
  const currentLocale: Locale = session?.user.locale ?? defaultLocale;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <LanguageCard current={currentLocale} />
      <DeleteAccountCard />
    </main>
  );
}
