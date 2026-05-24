import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { JobLedgerEntry, Page, PayoutEntryStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('partner.payouts');
  return { title: t('metadataTitle') };
}

const STATUS_PALETTE: Record<PayoutEntryStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-900',
  HELD: 'bg-sky-100 text-sky-900',
  RELEASED: 'bg-emerald-100 text-emerald-900',
  DISBURSED: 'bg-violet-100 text-violet-900',
};

export default async function PayoutsPage() {
  const page = await serverApi<Page<JobLedgerEntry>>('/v1/me/payouts?limit=50');

  const held = page.items.filter((e) => e.status === 'HELD');
  const released = page.items.filter((e) => e.status === 'RELEASED');
  const disbursed = page.items.filter((e) => e.status === 'DISBURSED');
  const sumByCurrency = (entries: JobLedgerEntry[]): { currency: string; amount: number }[] => {
    const totals = new Map<string, number>();
    for (const e of entries) totals.set(e.currency, (totals.get(e.currency) ?? 0) + e.amount);
    return [...totals.entries()].map(([currency, amount]) => ({ currency, amount }));
  };

  const t = await getTranslations('partner.payouts');
  const tChrome = await getTranslations('partner.chrome');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{tChrome('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard labelKey="summaryHeld" tone="bg-sky-50" totals={sumByCurrency(held)} />
        <SummaryCard
          labelKey="summaryReleased"
          tone="bg-emerald-50"
          totals={sumByCurrency(released)}
        />
        <SummaryCard
          labelKey="summaryDisbursed"
          tone="bg-violet-50"
          totals={sumByCurrency(disbursed)}
        />
      </div>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <PayoutsTable entries={page.items} />
      )}
    </main>
  );
}

function PayoutsTable({ entries }: { entries: JobLedgerEntry[] }) {
  const t = useTranslations('partner.payouts.table');
  const tStatus = useTranslations('partner.statuses.payouts');
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">{t('job')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('amount')}</th>
              <th className="px-4 py-2 font-medium">{t('status')}</th>
              <th className="px-4 py-2 font-medium">{t('when')}</th>
              <th className="px-4 py-2 font-medium">{t('reference')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
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
                    {tStatus(e.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {e.status === 'DISBURSED'
                    ? formatDateTime(e.disbursedAt)
                    : e.status === 'RELEASED'
                      ? formatDateTime(e.releasedAt)
                      : formatDateTime(e.cooldownUntil)}
                </td>
                <td className="px-4 py-3 text-xs">
                  {e.disbursementRef ? (
                    <code className="text-[11px]">{e.disbursementRef}</code>
                  ) : (
                    <span className="text-muted-foreground">{t('noReference')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  labelKey,
  tone,
  totals,
}: {
  labelKey: 'summaryHeld' | 'summaryReleased' | 'summaryDisbursed';
  tone: string;
  totals: { currency: string; amount: number }[];
}) {
  const t = useTranslations('partner.payouts');
  return (
    <Card className={tone}>
      <CardHeader>
        <CardTitle className="text-base">{t(labelKey)}</CardTitle>
      </CardHeader>
      <CardContent>
        {totals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('summaryEmpty')}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {totals.map((tt) => (
              <li key={tt.currency} className="flex items-baseline justify-between">
                <span className="text-muted-foreground">{tt.currency}</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(tt.amount, tt.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
