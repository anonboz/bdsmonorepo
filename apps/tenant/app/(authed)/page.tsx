import Link from 'next/link';

import type { UnreadCountResponse } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NotificationBellLink } from './_components/notification-bell-link';
import { APP_NAME } from '../../lib/app-config';
import { getSession, serverApi } from '../../lib/session';

export default async function HomePage() {
  // Guarded by (authed)/layout — session is guaranteed.
  const session = (await getSession())!;
  // SSR the initial unread count so the bell renders correctly before
  // hydration; the client island takes over for polling.
  const { unread } = await serverApi<UnreadCountResponse>('/v1/notifications/unread-count').catch(
    () => ({ unread: 0 }),
  );
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
          <p className="text-muted-foreground">
            Signed in as <strong>{session.user.displayName}</strong>.
          </p>
        </div>
        <NotificationBellLink initialUnread={unread} />
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>My leases</CardTitle>
            <CardDescription>Current + past.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/my-leases">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My bills</CardTitle>
            <CardDescription>Issued and paid.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/my-bills">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My tickets</CardTitle>
            <CardDescription>Repairs and reports.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/my-tickets">Open</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My ratings</CardTitle>
          <CardDescription>See what landlords have said about you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/me/ratings">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Browse listings</CardTitle>
          <CardDescription>Find your next place.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/browse">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My applications</CardTitle>
          <CardDescription>Track listings you&apos;ve applied to.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/me/applications">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>Online payments land in upcoming phases.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
