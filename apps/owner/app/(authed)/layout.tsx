import { redirect } from 'next/navigation';

import { AnalyticsProvider } from './_components/analytics-provider';
import { APP_ROLE } from '../../lib/app-config';
import { getSession } from '../../lib/session';

/**
 * Authentication + role gate. Wraps every route inside `(authed)`. If the
 * caller has no session, redirect to /login. If they're authenticated but
 * don't have this app's role (e.g., a tenant hitting the admin app), send
 * them to the access-denied page.
 */
export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const hasRole = session.user.roles.includes(APP_ROLE);
  if (!hasRole) redirect('/forbidden');

  return (
    <>
      <AnalyticsProvider userId={session.user.id} roles={session.user.roles} />
      {children}
    </>
  );
}
