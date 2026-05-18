import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { APP_NAME, APP_ROLE } from '../../lib/app-config.js';
import { getSession } from '../../lib/session.js';

export default async function HomePage() {
  // Guarded by (authed)/layout — session is guaranteed.
  const session = (await getSession())!;
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
        <p className="text-muted-foreground">
          Signed in as <strong>{session.user.displayName}</strong> ({APP_ROLE}).
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>
            Phase 1 landing page. Real admin dashboards land in Phase 3.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            This app is gated to the <code>ADMIN</code> role. Other roles see the
            access-denied page.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
