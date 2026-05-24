import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@repo/i18n';
import { getLocaleFromRequest } from '@repo/i18n/server';

import { LoginForm } from './login-form';
import { APP_NAME, APP_ROLE } from '../../lib/app-config';
import { getSession } from '../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.login');
  return { title: t('title') };
}

export default async function LoginPage() {
  const session = await getSession();
  if (session?.user.roles.includes(APP_ROLE)) redirect('/');

  const t = await getTranslations('owner.login');
  const currentLocale = await getLocaleFromRequest();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <div className="mb-6 flex justify-end">
        <LocaleSwitcher current={currentLocale} />
      </div>
      <header className="mb-8 space-y-1 text-center">
        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <LoginForm />
    </main>
  );
}
