import Link from 'next/link';

import type { Lease, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NewTicketForm } from './new-ticket-form';
import { serverApi } from '../../../../lib/session';

export const metadata = { title: 'New ticket' };

export default async function NewTicketPage() {
  const leases = await serverApi<Page<Lease>>('/v1/me/leases?status=ACTIVE&limit=10');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-tickets">← Back to my tickets</Link>
        </Button>
        <h1 className="text-2xl font-semibold">New ticket</h1>
      </div>

      {leases.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No active leases</CardTitle>
            <CardDescription>
              You need an active lease to raise a ticket. Talk to your landlord if this is
              unexpected.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/my-leases">View my leases</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <NewTicketForm leases={leases.items} />
      )}
    </main>
  );
}
