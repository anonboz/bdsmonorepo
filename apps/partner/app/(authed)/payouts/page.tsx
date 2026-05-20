import Link from 'next/link';

import type { JobLedgerEntry, Page, PayoutEntryStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Payouts' };

const STATUS_PALETTE: Record<PayoutEntryStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  HELD: 'bg-sky-100 text-sky-900',
  RELEASED: 'bg-emerald-100 text-emerald-900',
};

export default async function PayoutsPage() {
  const page = await serverApi<Page<JobLedgerEntry>>('/v1/me/payouts?limit=50');

  const held = page.items.filter((e) => e.status === 'HELD');
  const released = page.items.filter((e) => e.status === 'RELEASED');
  const sumByCurrency = (entries: JobLedgerEntry[]): { currency: string; amount: number }[] => {
    const totals = new Map<string, number>();
    for (const e of entries) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);
    return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
  };

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Your share of completed jobs. Released amounts cleared the 3-day cooldown.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard label="Held" tone="bg-sky-50" totals={sumByCurrency(held)} />
        <SummaryCard label="Released" tone="bg-emerald-50" totals={sumByCurrency(released)} />
      </div>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No payouts yet</CardTitle>
            <CardDescription>Complete a job to earn your first.</CardDescription>
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
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Cooldown / released</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="px-4 py-3 text-xs">
                      <Link href={`/jobs/${e.jobId}`} className="underline">
                        {e.jobId.slice(-8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(e.amount, e.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PALETTE[e.status]}`}
                      >
                        {e.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {e.status === 'RELEASED'
                        ? formatDateTime(e.releasedAt)
                        : formatDateTime(e.cooldownUntil)}
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

function SummaryCard({
  label,
  tone,
  totals,
}: {
  label: string;
  tone: string;
  totals: { currency: string; amount: number }[];
}) {
  return (
    <Card className={tone}>
      <CardHeader>
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {totals.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {totals.map((t) => (
              <li key={t.currency} className="flex items-baseline justify-between">
                <span className="text-muted-foreground">{t.currency}</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(t.amount, t.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
