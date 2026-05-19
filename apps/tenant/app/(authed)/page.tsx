import Link from 'next/link';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { APP_NAME } from '../../lib/app-config';
import { getSession } from '../../lib/session';

export default async function HomePage() {
  // Guarded by (authed)/layout — session is guaranteed.
  const session = (await getSession())!;
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
        <p className="text-muted-foreground">
          Signed in as <strong>{session.user.displayName}</strong>.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>My leases</CardTitle>
          <CardDescription>See your current and past leases.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/my-leases">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>
            Bills, payments, tickets and ratings land across Phases 2 and 3.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
