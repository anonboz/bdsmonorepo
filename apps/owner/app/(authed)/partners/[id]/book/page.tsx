import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { PartnerSummary } from '@repo/shared';
import { Button } from '@repo/ui';

import { BookForm } from './book-form';
import { ApiError } from '../../../../../lib/api';
import { serverApi } from '../../../../../lib/session';

export const metadata = { title: 'Book partner' };

export default async function BookPartnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const partner = await fetchPartner(id);
  if (!partner) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/partners/${id}`}>← Back to partner</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Book {partner.businessName}</h1>
        <p className="text-sm text-muted-foreground">
          Send a request. They&apos;ll come back with a quote.
        </p>
      </div>

      <BookForm partner={partner} />
    </main>
  );
}

async function fetchPartner(id: string): Promise<PartnerSummary | null> {
  try {
    return await serverApi<PartnerSummary>(`/v1/partners/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
