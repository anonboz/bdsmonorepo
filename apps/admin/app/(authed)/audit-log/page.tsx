import Link from 'next/link';

import { getFormatters } from '@repo/i18n';
import type { AuditLogEntry, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Audit log' };

type SearchParams = Promise<{
  action?: string;
  actorId?: string;
  target?: string;
}>;

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const fmt = getFormatters('en');
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '50' });
  if (sp.action) qs.set('action', sp.action);
  if (sp.actorId) qs.set('actorId', sp.actorId);
  if (sp.target) qs.set('target', sp.target);

  const page = await serverApi<Page<AuditLogEntry>>(`/v1/admin/audit-log?${qs}`);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length} entries · newest first ·{' '}
          {(sp.action ?? sp.actorId ?? sp.target) ? (
            <Link href="/audit-log" className="underline">
              clear filters
            </Link>
          ) : (
            'all actions'
          )}
        </p>
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No entries</CardTitle>
            <CardDescription>
              Either nothing matches the filter, or no admin actions have been taken yet.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Actor</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Target</th>
                  <th className="px-4 py-2 font-medium">Meta</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id} className="border-b align-top last:border-0">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmt.formatDateTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{e.actorName ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{e.actorId ?? 'system'}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{e.action}</td>
                    <td className="px-4 py-3 font-mono text-xs">{e.target ?? '—'}</td>
                    <td className="px-4 py-3">
                      {e.meta ? (
                        <pre className="whitespace-pre-wrap text-[10px] leading-tight text-muted-foreground">
                          {JSON.stringify(e.meta, null, 2)}
                        </pre>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
