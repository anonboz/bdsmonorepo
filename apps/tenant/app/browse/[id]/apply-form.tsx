'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Application } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner, Textarea } from '@repo/ui';

import { ApiError, api } from '../../../lib/api';

/**
 * Apply form for a public campaign. POSTs `/v1/me/applications`. On success
 * redirects to the application detail page so the tenant can track / withdraw.
 */
export function ApplyForm({ campaignId }: { campaignId: string }) {
  const t = useTranslations('tenant.browse.apply');
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = message.trim();
      const body: Record<string, unknown> = { campaignId };
      if (trimmed) body.message = trimmed;
      const created = await api.post<Application>('/v1/me/applications', body);
      router.push(`/me/applications/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('couldNotSubmit'));
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('couldNotSubmitTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={t('placeholder')}
        rows={4}
        maxLength={2000}
        disabled={busy}
        aria-label={t('messageAria')}
      />
      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}
        {t('send')}
      </Button>
    </form>
  );
}
