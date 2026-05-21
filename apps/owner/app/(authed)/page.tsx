import Link from 'next/link';

import type { UnreadCountResponse } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NotificationBellLink } from './_components/notification-bell-link';
import { APP_NAME } from '../../lib/app-config';
import { getSession, serverApi } from '../../lib/session';

export default async function HomePage() {
  // Guarded by (authed)/layout — session is guaranteed.
  const session = (await getSession())!;
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
            <CardTitle>Dashboard</CardTitle>
            <CardDescription>Occupancy, MRR, overdue.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Houses</CardTitle>
            <CardDescription>Properties, units, leases.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/houses">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tickets</CardTitle>
            <CardDescription>Repair + report queue.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/tickets">Open</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My ratings</CardTitle>
          <CardDescription>See what tenants have said about you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/me/ratings">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partners</CardTitle>
          <CardDescription>Browse service providers in your area.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/partners">Browse</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My partner bookings</CardTitle>
          <CardDescription>Track requests, quotes, and completed jobs.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/me/service-jobs">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Service charges</CardTitle>
          <CardDescription>What completed partner jobs cost you.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/me/charges">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>Partner ratings land next.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
