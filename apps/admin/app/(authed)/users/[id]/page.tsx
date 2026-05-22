import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { AdminUser, KycStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { EraseActions } from './erase-actions';
import { KycActions } from './kyc-actions';
import { SuspendActions } from './suspend-actions';
import { ApiError } from '../../../../lib/api';
import { formatDateTime } from '../../../../lib/format';
import { getSession, serverApi } from '../../../../lib/session';

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, session] = await Promise.all([fetchUser(id), getSession()]);
  if (!user) notFound();

  const isSelf = session?.user.id === user.id;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/users">← Back to users</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{user.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {user.email ?? '—'} · {user.roles.join(', ')} ·{' '}
              {user.isSuspended ? (
                <span className="font-medium text-destructive">suspended</span>
              ) : (
                'active'
              )}{' '}
              · KYC <KycLabel status={user.kycStatus} />
            </p>
          </div>
        </div>
      </div>

      {isSelf && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">That is you</CardTitle>
            <CardDescription>
              You cannot suspend or change the KYC state of your own admin account.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Suspension</CardTitle>
            <CardDescription>
              Suspending blocks this user from acting on any app on their next request.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSelf ? (
              <p className="text-sm text-muted-foreground">Not available on your own account.</p>
            ) : (
              <SuspendActions userId={user.id} isSuspended={user.isSuspended} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">KYC</CardTitle>
            <CardDescription>
              Approve to grant trusted-user status. Reject with a reason that the user will see.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSelf ? (
              <p className="text-sm text-muted-foreground">Not available on your own account.</p>
            ) : (
              <KycActions userId={user.id} current={user.kycStatus} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="User ID" value={user.id} />
            <Stat label="Phone" value={user.phone ?? '—'} />
            <Stat label="Last login" value={formatDateTime(user.lastLoginAt)} />
            <Stat label="Created" value={formatDateTime(user.createdAt)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audit history</CardTitle>
          <CardDescription>
            <Link href={`/audit-log?target=User%3A${user.id}`} className="underline">
              View all entries targeting this user →
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>

      {!isSelf && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">Danger zone</CardTitle>
            <CardDescription>
              GDPR erasure anonymises PII, purges owned media from S3, and deletes the PostHog
              person. Bills and audit rows stay for legal retention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EraseActions userId={user.id} isAlreadyErased={user.deletedAt !== null} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function KycLabel({ status }: { status: KycStatus }) {
  return <span>{status.toLowerCase()}</span>;
}

async function fetchUser(id: string): Promise<AdminUser | null> {
  try {
    return await serverApi<AdminUser>(`/v1/admin/users/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
