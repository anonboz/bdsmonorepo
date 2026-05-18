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
          <CardTitle>Houses</CardTitle>
          <CardDescription>Manage the properties you own and their listings.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/houses">Open houses</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>
            Units, leases, bills, tickets, campaigns and the partner marketplace land in Phases 2–5.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
