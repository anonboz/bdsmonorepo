import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Application, ApplicationStatus, Page } from '@repo/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.applications');
  return { title: t('metadataTitle') };
}

const PALETTE: Record<ApplicationStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-900',
  REVIEWING: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  WITHDRAWN: 'bg-zinc-200 text-zinc-700',
};

export default async function MyApplicationsPage() {
  const page = await serverApi<Page<Application>>('/v1/me/applications?limit=20');
  const t = await getTranslations('tenant.applications');
  const fmt = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0
            ? t('summaryEmpty')
            : t('summaryCount', { count: page.items.length })}
        </p>
      </div>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>
              <Link href="/browse" className="underline">
                {t('browseLink')}
              </Link>
              {t('emptyDescriptionSuffix')}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((a) => (
            <ApplicationRow key={a.id} application={a} fmt={fmt} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ApplicationRow({ application, fmt }: { application: Application; fmt: Formatters }) {
  const t = useTranslations('tenant.applications');
  const tStatus = useTranslations('tenant.statuses.applications');
  return (
    <li>
      <Link
        href={`/me/applications/${application.id}`}
        className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold">
              {t('campaignLabel', { short: application.campaignId.slice(-8) })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('submittedAt', { date: fmt.formatDate(application.createdAt) })}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[application.status]}`}
          >
            {tStatus(application.status)}
          </span>
        </div>
      </Link>
    </li>
  );
}
