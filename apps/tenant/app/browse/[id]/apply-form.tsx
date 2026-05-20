'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Application } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner, Textarea } from '@repo/ui';

import { ApiError, api } from '../../../lib/api';

/**
 * Apply form for a public campaign. POSTs `/v1/me/applications`. On success
 * redirects to the application detail page so the tenant can track / withdraw.
 */
export function ApplyForm({ campaignId }: { campaignId: string }) {
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
      setError(err instanceof ApiError ? err.problem.title : 'Could not submit application.');
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not submit</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Optional message to the owner — why you're a good fit."
        rows={4}
        maxLength={2000}
        disabled={busy}
        aria-label="Message"
      />
      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}
        Send application
      </Button>
    </form>
  );
}
