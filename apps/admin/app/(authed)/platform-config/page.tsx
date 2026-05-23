import Link from 'next/link';

import type { PlatformConfig } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ConfigForm } from './config-form';
import { formatDateTime } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Platform config' };

export default async function PlatformConfigPage() {
  const config = await serverApi<PlatformConfig>('/v1/admin/platform-config');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Platform config</h1>
        <p className="text-sm text-muted-foreground">
          Singleton row covering platform-wide knobs. Changes apply on the next mint — already
          minted ledger rows keep their original rate.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Commission</CardTitle>
          <CardDescription>
            Platform cut on every completed partner job. Last updated{' '}
            {formatDateTime(config.updatedAt)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConfigForm initial={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Audit history</CardTitle>
          <CardDescription>
            <Link href={`/audit-log?target=PlatformConfig%3Asingleton`} className="underline">
              View all entries targeting platform config →
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
