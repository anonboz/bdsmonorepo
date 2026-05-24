import { getFormatters } from '@repo/i18n';
import type { Bill, Page, Payment, Ticket } from '@repo/shared';

import { ApiError } from '../../../../../lib/api';
import { serverApi } from '../../../../../lib/session';

/**
 * Phase 10.7 — three read-only support lists that hang off the user
 * detail page. Each fetches the first page server-side; no actions,
 * no pagination controls (support drills down via the per-resource
 * admin views when they need to).
 */
export async function TicketsCard({ userId }: { userId: string }) {
  const fmt = getFormatters('en');
  const page = await safeFetch<Page<Ticket>>(`/v1/admin/users/${userId}/tickets?limit=20`);
  return (
    <SectionCard title="Tickets" empty="No tickets for this user.">
      {page.items.length === 0 ? null : (
        <ul className="divide-y text-sm">
          {page.items.map((t) => (
            <li key={t.id} className="grid grid-cols-[1fr_auto] gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {t.category.toLowerCase()} · {t.status.toLowerCase()} ·{' '}
                  {t.reporterId === userId ? 'reporter' : 'assignee'}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{fmt.formatDateTime(t.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export async function BillsCard({ userId }: { userId: string }) {
  const page = await safeFetch<Page<Bill>>(`/v1/admin/users/${userId}/bills?limit=20`);
  return (
    <SectionCard title="Bills" empty="No bills for this user.">
      {page.items.length === 0 ? null : (
        <ul className="divide-y text-sm">
          {page.items.map((b) => (
            <li key={b.id} className="grid grid-cols-[1fr_auto] gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {b.periodStart} → {b.periodEnd}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {b.status.toLowerCase()} · due {b.dueDate}
                </p>
              </div>
              <p className="text-xs font-medium">
                {b.total.toLocaleString()} {b.currency}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export async function PaymentsCard({ userId }: { userId: string }) {
  const fmt = getFormatters('en');
  const page = await safeFetch<Page<Payment>>(`/v1/admin/users/${userId}/payments?limit=20`);
  return (
    <SectionCard title="Payments" empty="No payments for this user.">
      {page.items.length === 0 ? null : (
        <ul className="divide-y text-sm">
          {page.items.map((p) => {
            const isRefund = p.refundOfPaymentId !== null;
            return (
              <li key={p.id} className="grid grid-cols-[1fr_auto] gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {isRefund ? 'Refund' : 'Payment'} · {p.provider.toLowerCase()}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.status.toLowerCase()} · {fmt.formatDateTime(p.receivedAt ?? p.createdAt)}
                  </p>
                </div>
                <p className={`text-xs font-medium ${isRefund ? 'text-destructive' : ''}`}>
                  {p.amount.toLocaleString()} {p.currency}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

function SectionCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="border-b px-6 py-3">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="px-6 py-4">
        {children ?? <p className="text-sm text-muted-foreground">{empty}</p>}
      </div>
    </section>
  );
}

async function safeFetch<T extends { items: unknown[]; nextCursor: string | null }>(
  path: string,
): Promise<T> {
  try {
    return await serverApi<T>(path);
  } catch (err) {
    // Defensive — a single section failing shouldn't blank the page.
    if (err instanceof ApiError) {
      return { items: [], nextCursor: null } as unknown as T;
    }
    throw err;
  }
}
