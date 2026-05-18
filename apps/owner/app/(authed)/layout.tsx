import { redirect } from 'next/navigation';

import { APP_ROLE } from '../../lib/app-config.js';
import { getSession } from '../../lib/session.js';

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

  return <>{children}</>;
}
