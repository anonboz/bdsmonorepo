import Link from 'next/link';

import type { UnreadCountResponse } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NotificationBellLink } from './_components/notification-bell-link';
import { APP_NAME, AUTH_PASSWORD_ENABLED } from '../../lib/app-config';
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

      {AUTH_PASSWORD_ENABLED && !session.hasPassword && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Set a password</CardTitle>
            <CardDescription>
              Add a password so you can sign in with your phone number — no code needed next time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/set-password">Set a password</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Dashboard</CardTitle>
            <CardDescription>Users, GMV, overdue, ticket SLA.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campaigns</CardTitle>
            <CardDescription>Approve / reject pending listings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/campaigns?status=PENDING">Open queue</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Search, suspend, review KYC.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/users">Open</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Houses</CardTitle>
            <CardDescription>Flag, clear, reject listings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
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

        <Card>
          <CardHeader>
            <CardTitle>Payouts</CardTitle>
            <CardDescription>Disburse partner payouts after the 3-day cooldown.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/payouts">Open queue</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform config</CardTitle>
          <CardDescription>Commission rate + future platform-wide knobs.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/platform-config">Open</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Coming soon</CardTitle>
          <CardDescription>Refund moderation and Stripe Connect oversight.</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
