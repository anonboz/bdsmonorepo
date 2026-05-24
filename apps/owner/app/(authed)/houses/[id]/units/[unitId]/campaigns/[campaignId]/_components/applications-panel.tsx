import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Application, ApplicationStatus, Campaign, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApplicationActions } from './application-actions';
import { serverApi } from '../../../../../../../../../lib/session';

const PALETTE: Record<ApplicationStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-900',
  REVIEWING: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  WITHDRAWN: 'bg-zinc-200 text-zinc-700',
};

export async function ApplicationsPanel({
  houseId,
  unitId,
  campaign,
}: {
  houseId: string;
  unitId: string;
  campaign: Campaign;
}) {
  const page = await serverApi<Page<Application>>(
    `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}/applications?limit=50`,
  );
  const t = await getTranslations('owner.campaigns.applications');
  const fmt = getFormatters(await getLocale());

  const decidable = (a: Application) => a.status === 'SUBMITTED' || a.status === 'REVIEWING';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <CardDescription>
          {page.items.length === 0 ? t('empty') : t('count', { count: page.items.length })}
        </CardDescription>
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-3">
            {page.items.map((a) => (
              <ApplicationRow
                key={a.id}
                houseId={houseId}
                unitId={unitId}
                campaignId={campaign.id}
                application={a}
                decidable={decidable(a)}
                fmt={fmt}
              />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function ApplicationRow({
  houseId,
  unitId,
  campaignId,
  application,
  decidable,
  fmt,
}: {
  houseId: string;
  unitId: string;
  campaignId: string;
  application: Application;
  decidable: boolean;
  fmt: Formatters;
}) {
  const t = useTranslations('owner.campaigns.applications');
  const tStatus = useTranslations('owner.statuses.applications');
  return (
    <li className="rounded-md border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">{application.applicantName}</p>
          <p className="text-xs text-muted-foreground">
            {t('appliedAt', { date: fmt.formatDateTime(application.createdAt) })}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[application.status]}`}
        >
          {tStatus(application.status)}
        </span>
      </div>
      {application.message && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{application.message}</p>
      )}
      {application.rejectionReason && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('rejectionReasonPrefix', { reason: application.rejectionReason })}
        </p>
      )}
      {decidable && (
        <div className="mt-3">
          <ApplicationActions
            houseId={houseId}
            unitId={unitId}
            campaignId={campaignId}
            applicationId={application.id}
          />
        </div>
      )}
    </li>
  );
}
