import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { SetPasswordForm } from './set-password-form';
import { AUTH_PASSWORD_ENABLED } from '../../../lib/app-config';
import { getSession } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('partner.setPassword');
  return { title: t('title') };
}

export default async function SetPasswordPage() {
  // Feature-gated; the surrounding (authed) layout guarantees a session.
  if (!AUTH_PASSWORD_ENABLED) redirect('/');
  const session = (await getSession())!;
  // Nothing to do if a password is already set (a change-password flow is
  // a follow-up); send them home.
  if (session.hasPassword) redirect('/');

  const t = await getTranslations('partner.setPassword');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <header className="mb-8 space-y-1 text-center">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('subtitle', { phone: session.user.phone ?? '' })}
        </p>
      </header>
      <SetPasswordForm />
    </main>
  );
}
