import Link from 'next/link';

import type { Campaign, CampaignStatus, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Campaigns' };

type SearchParams = Promise<{
  q?: string;
  status?: CampaignStatus;
  ownerId?: string;
}>;

const PALETTE: Record<CampaignStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING: 'bg-amber-100 text-amber-900',
  LIVE: 'bg-emerald-100 text-emerald-900',
  CLOSED: 'bg-zinc-200 text-zinc-700',
  REJECTED: 'bg-rose-100 text-rose-900',
  EXPIRED: 'bg-zinc-200 text-zinc-700',
};

export default async function AdminCampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  // Default to PENDING since the queue is the most common entry.
  const status = sp.status ?? 'PENDING';
  const qs = new URLSearchParams({ limit: '50', status });
  if (sp.q) qs.set('q', sp.q);
  if (sp.ownerId) qs.set('ownerId', sp.ownerId);

  const page = await serverApi<Page<Campaign>>(`/v1/admin/campaigns?${qs}`);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length} matching · filter via the URL (?status=, ?q=, ?ownerId=)
        </p>
      </header>

      <FilterBar current={{ ...sp, status }} />

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No campaigns match</CardTitle>
            <CardDescription>Loosen filters or check the URL.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Published</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/campaigns/${c.id}`} className="block">
                        <p className="font-medium">{c.title}</p>
                        <p className="text-xs text-muted-foreground">{c.id}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <Link href={`/users/${c.ownerId}`} className="underline">
                        {c.ownerId}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {c.publishedAt ? formatDateTime(c.publishedAt) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
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
  current: { q?: string; status: CampaignStatus; ownerId?: string };
}) {
  return (
    <form className="grid gap-2 sm:grid-cols-3">
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Search title / city"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <select
        name="status"
        defaultValue={current.status}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="PENDING">Pending</option>
        <option value="DRAFT">Draft</option>
        <option value="LIVE">Live</option>
        <option value="CLOSED">Closed</option>
        <option value="REJECTED">Rejected</option>
        <option value="EXPIRED">Expired</option>
      </select>
      <input
        name="ownerId"
        defaultValue={current.ownerId ?? ''}
        placeholder="Owner id"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
    </form>
  );
}

export function Badge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
