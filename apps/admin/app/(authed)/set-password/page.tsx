import { redirect } from 'next/navigation';

import { SetPasswordForm } from './set-password-form';
import { AUTH_PASSWORD_ENABLED } from '../../../lib/app-config';
import { getSession } from '../../../lib/session';

export const metadata = { title: 'Set a password' };

export default async function SetPasswordPage() {
  // Feature-gated; the surrounding (authed) layout guarantees a session.
  if (!AUTH_PASSWORD_ENABLED) redirect('/');
  const session = (await getSession())!;
  // Nothing to do if a password is already set (a change-password flow is
  // a follow-up); send them home.
  if (session.hasPassword) redirect('/');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <header className="mb-8 space-y-1 text-center">
        <h1 className="text-2xl font-semibold">Set a password</h1>
        <p className="text-sm text-muted-foreground">
          Add a password so you can sign in with your phone number{' '}
          <strong>{session.user.phone ?? ''}</strong> — no code needed next time.
        </p>
      </header>
      <SetPasswordForm />
    </main>
  );
}
