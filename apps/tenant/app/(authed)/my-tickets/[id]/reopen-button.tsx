'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

export function ReopenButton({ ticketId }: { ticketId: string }) {
  const t = useTranslations('tenant.tickets.detail');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (!window.confirm(t('reopenConfirm'))) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/me/tickets/${ticketId}/transitions`, { to: 'REOPENED' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('reopenFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        {t('reopenButton')}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
