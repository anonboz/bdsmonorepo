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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>How owners see you.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/profile">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>Manage your catalog + pricing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/services">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Jobs</CardTitle>
            <CardDescription>Incoming requests + in-flight work.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/jobs">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payouts</CardTitle>
            <CardDescription>Held + released balances.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/payouts">Open</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>Ratings land in the next Phase 5 slice.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
