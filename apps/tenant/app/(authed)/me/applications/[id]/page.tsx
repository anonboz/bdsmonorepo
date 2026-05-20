import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Application, ApplicationStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { WithdrawButton } from './withdraw-button';
import { ApiError } from '../../../../../lib/api';
import { formatDateTime } from '../../../../../lib/format';
import { serverApi } from '../../../../../lib/session';

const PALETTE: Record<ApplicationStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-900',
  REVIEWING: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  WITHDRAWN: 'bg-zinc-200 text-zinc-700',
};

export default async function MyApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const application = await fetchApplication(id);
  if (!application) notFound();

  const canWithdraw = application.status === 'SUBMITTED' || application.status === 'REVIEWING';

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/me/applications">← Back to applications</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Application</h1>
            <p className="text-sm text-muted-foreground">
              <span
                className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[application.status]}`}
              >
                {application.status.toLowerCase()}
              </span>
              · submitted {formatDateTime(application.createdAt)}
            </p>
          </div>
          {canWithdraw && <WithdrawButton applicationId={application.id} />}
        </div>
      </div>

      {application.status === 'REJECTED' && application.rejectionReason && (
        <div
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
          role="status"
        >
          <p className="text-sm font-semibold">Rejected by the owner</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            Reason: {application.rejectionReason}
          </p>
        </div>
      )}

      {application.status === 'ACCEPTED' && (
        <div
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900"
          role="status"
        >
          <p className="text-sm font-semibold">Accepted</p>
          <p className="mt-1 text-sm leading-relaxed">
            The owner accepted your application and started a lease draft. They will finalize the
            terms and reach out.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your message</CardTitle>
          <CardDescription>What you sent to the owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {application.message ?? <em className="text-muted-foreground">No message.</em>}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Listing</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href={`/browse/${application.campaignId}`}>View campaign</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

async function fetchApplication(id: string): Promise<Application | null> {
  try {
    return await serverApi<Application>(`/v1/me/applications/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
