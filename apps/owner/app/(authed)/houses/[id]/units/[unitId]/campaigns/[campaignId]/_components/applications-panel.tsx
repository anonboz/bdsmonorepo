import type { Application, ApplicationStatus, Campaign, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApplicationActions } from './application-actions';
import { formatDateTime } from '../../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../../lib/session';

const PALETTE: Record<ApplicationStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-900',
  REVIEWING: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  WITHDRAWN: 'bg-zinc-200 text-zinc-700',
};

/**
 * Renders below the campaign actions card. Lists every application on
 * this campaign; renders Accept/Reject buttons on each one that is
 * still SUBMITTED or REVIEWING.
 */
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

  const decidable = (a: Application) => a.status === 'SUBMITTED' || a.status === 'REVIEWING';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Applications</CardTitle>
        <CardDescription>
          {page.items.length === 0
            ? 'No applications yet.'
            : `${page.items.length} application${page.items.length === 1 ? '' : 's'} on this listing.`}
        </CardDescription>
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-3">
            {page.items.map((a) => (
              <li key={a.id} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">{a.applicantName}</p>
                    <p className="text-xs text-muted-foreground">
                      Applied {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[a.status]}`}
                  >
                    {a.status.toLowerCase()}
                  </span>
                </div>
                {a.message && (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{a.message}</p>
                )}
                {a.rejectionReason && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Rejection reason: {a.rejectionReason}
                  </p>
                )}
                {decidable(a) && (
                  <div className="mt-3">
                    <ApplicationActions
                      houseId={houseId}
                      unitId={unitId}
                      campaignId={campaign.id}
                      applicationId={a.id}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
