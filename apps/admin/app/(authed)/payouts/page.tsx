import { getFormatters } from '@repo/i18n';
import type { AdminPendingPayout, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { DisburseRow } from './_components/disburse-row';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Pending payouts' };

export default async function AdminPayoutsPage() {
  const fmt = getFormatters('en');
  const page = await serverApi<Page<AdminPendingPayout>>(
    '/v1/admin/payouts/pending?limit=50&sort=asc',
  );

  // Per-currency totals so the page header shows what's owed at a glance.
  const totals = new Map<string, number>();
  for (const p of page.items) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Pending payouts</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0
            ? 'All payouts are caught up.'
            : `${page.items.length} payout${
                page.items.length === 1 ? '' : 's'
              } waiting on a bank transfer.`}
        </p>
        {totals.size > 0 && (
          <p className="text-sm text-muted-foreground">
            Total owed:{' '}
            {[...totals.entries()]
              .map(([currency, amount]) => fmt.formatMoney(amount, currency))
              .join(' · ')}
          </p>
        )}
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing to disburse</CardTitle>
            <CardDescription>
              When the daily sweeper flips a partner&apos;s HELD payout to RELEASED, it shows up
              here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Partner</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Released</th>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.partnerName}</p>
                      {p.partnerBusinessName && (
                        <p className="text-xs text-muted-foreground">{p.partnerBusinessName}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {fmt.formatMoney(p.amount, p.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {fmt.formatDate(p.releasedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <code className="text-[11px]">{p.jobId.slice(-8)}</code>
                    </td>
                    <td className="px-4 py-3">
                      <DisburseRow entry={p} />
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
