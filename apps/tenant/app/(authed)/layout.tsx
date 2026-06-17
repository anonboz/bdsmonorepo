import { redirect } from 'next/navigation';

import { AnalyticsProvider } from './_components/analytics-provider';
import { Sidebar } from './_components/sidebar';
import { APP_ROLE } from '../../lib/app-config';
import { getSession } from '../../lib/session';

/**
 * Authentication + role gate. Wraps every route inside `(authed)`. If the
 * caller has no session, redirect to /login. If they're authenticated but
 * don't have this app's role (e.g., a tenant hitting the admin app), send
 * them to the access-denied page.
 *
 * Also mounts the Client `AnalyticsProvider` here so PostHog only inits
 * once the gate confirms a session — no point identifying anonymous users.
 */
export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const hasRole = session.user.roles.includes(APP_ROLE);
  if (!hasRole) redirect('/forbidden');

  return (
    <div className="min-h-dvh lg:pl-64">
      <AnalyticsProvider userId={session.user.id} roles={session.user.roles} />
      <Sidebar userName={session.user.displayName} />
      <div className="pt-14 lg:pt-0">{children}</div>
    </div>
  );
}
