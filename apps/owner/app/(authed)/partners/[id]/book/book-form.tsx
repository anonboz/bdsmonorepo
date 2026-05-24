'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { PartnerSummary, ServiceJob } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  FormField,
  Spinner,
  Textarea,
} from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

export function BookForm({ partner, ticketId }: { partner: PartnerSummary; ticketId?: string }) {
  const t = useTranslations('owner.partners.book');
  const tChrome = useTranslations('owner.chrome');
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [serviceId, setServiceId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const trimmed = description.trim();
      const body: Record<string, unknown> = { partnerId: partner.id };
      if (trimmed) body.description = trimmed;
      if (serviceId) body.serviceId = serviceId;
      if (ticketId) body.ticketId = ticketId;
      const created = await api.post<ServiceJob>('/v1/me/service-jobs', body);
      router.push(`/me/service-jobs/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('failed'));
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('failedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {partner.activeServices.length > 0 && (
        <FormField label={t('serviceLabel')} htmlFor="serviceId">
          <select
            id="serviceId"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">{t('serviceNone')}</option>
            {partner.activeServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <FormField
        label={t('descriptionLabel')}
        htmlFor="description"
        description={t('descriptionHelp')}
      >
        <Textarea
          id="description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </FormField>

      <div className="flex gap-3">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {t('sendButton')}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={busy}>
          {tChrome('cancel')}
        </Button>
      </div>
    </form>
  );
}
