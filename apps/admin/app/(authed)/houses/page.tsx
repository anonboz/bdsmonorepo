import Link from 'next/link';

import type { House, HouseModerationStatus, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Houses' };

type SearchParams = Promise<{
  q?: string;
  moderationStatus?: HouseModerationStatus;
  ownerId?: string;
}>;

export default async function AdminHousesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '50' });
  if (sp.q) qs.set('q', sp.q);
  if (sp.moderationStatus) qs.set('moderationStatus', sp.moderationStatus);
  if (sp.ownerId) qs.set('ownerId', sp.ownerId);

  const page = await serverApi<Page<House>>(`/v1/admin/houses?${qs}`);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Houses</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length} matching · filter via the URL (?q=, ?moderationStatus=, ?ownerId=)
        </p>
      </header>

      <FilterBar current={sp} />

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No houses match</CardTitle>
            <CardDescription>Loosen filters or check the URL.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Name / City</th>
                  <th className="px-4 py-2 font-medium">Owner</th>
                  <th className="px-4 py-2 font-medium">Units</th>
                  <th className="px-4 py-2 font-medium">Published</th>
                  <th className="px-4 py-2 font-medium">Moderation</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((h) => (
                  <tr key={h.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link href={`/houses/${h.id}`} className="block">
                        <p className="font-medium">{h.name}</p>
                        <p className="text-xs text-muted-foreground">{h.address.city}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <Link href={`/users/${h.ownerId}`} className="underline">
                        {h.ownerId}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs">{h.unitCount}</td>
                    <td className="px-4 py-3 text-xs">{h.isPublished ? 'yes' : 'no'}</td>
                    <td className="px-4 py-3">
                      <ModerationBadge status={h.moderationStatus} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(h.createdAt)}
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
  current: { q?: string; moderationStatus?: HouseModerationStatus; ownerId?: string };
}) {
  return (
    <form className="grid gap-2 sm:grid-cols-3">
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Search name / city"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <select
        name="moderationStatus"
        defaultValue={current.moderationStatus ?? ''}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Any status</option>
        <option value="OK">OK</option>
        <option value="FLAGGED">Flagged</option>
        <option value="REJECTED">Rejected</option>
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

export function ModerationBadge({ status }: { status: HouseModerationStatus }) {
  const palette: Record<HouseModerationStatus, string> = {
    OK: 'bg-emerald-100 text-emerald-900',
    FLAGGED: 'bg-amber-100 text-amber-900',
    REJECTED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
