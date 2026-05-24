import Link from 'next/link';

import { getFormatters } from '@repo/i18n';
import type { AdminUser, KycStatus, Page, Role } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Users' };

type SearchParams = Promise<{
  q?: string;
  role?: Role;
  kycStatus?: KycStatus;
  isSuspended?: string;
}>;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const fmt = getFormatters('en');
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '50' });
  if (sp.q) qs.set('q', sp.q);
  if (sp.role) qs.set('role', sp.role);
  if (sp.kycStatus) qs.set('kycStatus', sp.kycStatus);
  if (sp.isSuspended) qs.set('isSuspended', sp.isSuspended);

  const page = await serverApi<Page<AdminUser>>(`/v1/admin/users?${qs}`);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length} matching · filter via the URL (?q=, ?role=, ?kycStatus=,
          ?isSuspended=true|false)
        </p>
      </header>

      <FilterBar current={sp} />

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No users match</CardTitle>
            <CardDescription>Loosen filters or check the URL.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Name / Email</th>
                  <th className="px-4 py-2 font-medium">Roles</th>
                  <th className="px-4 py-2 font-medium">KYC</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((u) => (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/users/${u.id}`} className="block">
                        <p className="font-medium">{u.displayName}</p>
                        <p className="text-xs text-muted-foreground">{u.email ?? u.phone ?? '—'}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">{u.roles.join(', ')}</td>
                    <td className="px-4 py-3">
                      <KycBadge status={u.kycStatus} />
                    </td>
                    <td className="px-4 py-3">
                      {u.isSuspended ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-900">
                          suspended
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmt.formatDateTime(u.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function FilterBar({
  current,
}: {
  current: { q?: string; role?: Role; kycStatus?: KycStatus; isSuspended?: string };
}) {
  return (
    <form className="grid gap-2 sm:grid-cols-4">
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Search name / email"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <select
        name="role"
        defaultValue={current.role ?? ''}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">All roles</option>
        <option value="ADMIN">Admin</option>
        <option value="OWNER">Owner</option>
        <option value="TENANT">Tenant</option>
        <option value="PARTNER">Partner</option>
      </select>
      <select
        name="kycStatus"
        defaultValue={current.kycStatus ?? ''}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Any KYC</option>
        <option value="NONE">None</option>
        <option value="PENDING">Pending</option>
        <option value="APPROVED">Approved</option>
        <option value="REJECTED">Rejected</option>
      </select>
      <select
        name="isSuspended"
        defaultValue={current.isSuspended ?? ''}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Any state</option>
        <option value="false">Active</option>
        <option value="true">Suspended</option>
      </select>
    </form>
  );
}

function KycBadge({ status }: { status: KycStatus }) {
  const palette: Record<KycStatus, string> = {
    NONE: 'bg-zinc-100 text-zinc-700',
    PENDING: 'bg-amber-100 text-amber-900',
    APPROVED: 'bg-emerald-100 text-emerald-900',
    REJECTED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
