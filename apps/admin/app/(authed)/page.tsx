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

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Search, suspend, review KYC.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/users">Open users</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Houses</CardTitle>
            <CardDescription>Flag, clear, reject listings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/houses?moderationStatus=FLAGGED">Open queue</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Every sensitive action, who and when.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/audit-log">Open log</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>Fee config and platform dashboards land in follow-ups.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
