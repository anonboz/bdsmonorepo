import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

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
  const tDetail = await getTranslations('tenant.applications.detail');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/me/applications">{tDetail('backToList')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{tDetail('title')}</h1>
            <StatusLine status={application.status} createdAt={application.createdAt} />
          </div>
          {canWithdraw && <WithdrawButton applicationId={application.id} />}
        </div>
      </div>

      {application.status === 'REJECTED' && application.rejectionReason && (
        <div
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
          role="status"
        >
          <p className="text-sm font-semibold">{tDetail('rejectedTitle')}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {tDetail('rejectedReasonPrefix', { reason: application.rejectionReason })}
          </p>
        </div>
      )}

      {application.status === 'ACCEPTED' && (
        <div
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-emerald-900"
          role="status"
        >
          <p className="text-sm font-semibold">{tDetail('acceptedTitle')}</p>
          <p className="mt-1 text-sm leading-relaxed">{tDetail('acceptedBody')}</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('messageTitle')}</CardTitle>
          <CardDescription>{tDetail('messageDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <MessageBody message={application.message ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('listingTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href={`/browse/${application.campaignId}`}>{tDetail('viewCampaign')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function StatusLine({ status, createdAt }: { status: ApplicationStatus; createdAt: string }) {
  const tStatus = useTranslations('tenant.statuses.applications');
  const tDetail = useTranslations('tenant.applications.detail');
  return (
    <p className="text-sm text-muted-foreground">
      <span className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[status]}`}>
        {tStatus(status)}
      </span>
      · {tDetail('metaSubmitted', { date: formatDateTime(createdAt) })}
    </p>
  );
}

function MessageBody({ message }: { message: string | null }) {
  const t = useTranslations('tenant.applications.detail');
  if (message) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{message}</p>;
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      <em className="text-muted-foreground">{t('noMessage')}</em>
    </p>
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
