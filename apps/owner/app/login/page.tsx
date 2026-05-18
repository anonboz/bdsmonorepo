import { redirect } from 'next/navigation';

import { LoginForm } from './login-form.js';
import { APP_NAME, APP_ROLE } from '../../lib/app-config.js';
import { getSession } from '../../lib/session.js';

export default async function LoginPage() {
  const session = await getSession();
  if (session?.user.roles.includes(APP_ROLE)) redirect('/');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <header className="mb-8 space-y-1 text-center">
        <h1 className="text-2xl font-semibold">{APP_NAME}</h1>
        <p className="text-sm text-muted-foreground">Sign in to continue.</p>
      </header>
      <LoginForm />
    </main>
  );
}
