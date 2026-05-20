import Link from 'next/link';

import type { JobLedgerEntry, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export const metadata = { title: 'Service charges' };

export default async function MyChargesPage() {
  const page = await serverApi<Page<JobLedgerEntry>>('/v1/me/charges?limit=50');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Service charges</h1>
        <p className="text-sm text-muted-foreground">
          What each completed partner job adds to your bill. Real payment provider lands in Phase 6
          — these are informational accruals for now.
        </p>
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No charges yet</CardTitle>
            <CardDescription>
              Charges appear here when a partner completes a job for you.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Job</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3 text-xs">
                      <Link href={`/me/service-jobs/${e.jobId}`} className="underline">
                        {e.jobId.slice(-8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-rose-700">
                      {formatMoney(e.amount, e.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(e.createdAt)}
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
