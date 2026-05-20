'use client';

import { useRouter } from 'next/navigation';
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

export function BookForm({ partner }: { partner: PartnerSummary }) {
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
      const created = await api.post<ServiceJob>('/v1/me/service-jobs', body);
      router.push(`/me/service-jobs/${created.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Could not book partner.');
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not book</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {partner.activeServices.length > 0 && (
        <FormField label="Service (optional)" htmlFor="serviceId">
          <select
            id="serviceId"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">(none)</option>
            {partner.activeServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
      )}

      <FormField
        label="What do you need?"
        htmlFor="description"
        description="Short note for the partner so they can quote."
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
          Send request
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
