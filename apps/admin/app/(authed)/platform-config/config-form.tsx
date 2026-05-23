'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { PlatformConfig } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Input, Label, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../lib/api';

/**
 * Edits the platform-config singleton's commission rate. Inputs in
 * percent (0–50) for human readability; converts to bps on submit.
 * Bounds enforced server-side; this form preserves the user's input
 * even on failure so they can correct it without re-typing.
 */
export function ConfigForm({ initial }: { initial: PlatformConfig }) {
  const router = useRouter();
  const [percent, setPercent] = useState((initial.commissionBps / 100).toString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      const numeric = Number.parseFloat(percent);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 50) {
        throw new Error('Commission must be between 0 and 50 percent.');
      }
      // Two decimal places at most — bps rounds to integer. Round at
      // the boundary so 12.34% stays 1234 bps.
      const bps = Math.round(numeric * 100);
      await api.put<PlatformConfig>('/v1/admin/platform-config', { commissionBps: bps });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.problem.detail ?? err.problem.title)
          : err instanceof Error
            ? err.message
            : 'Update failed',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Update failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <AlertDescription>Saved.</AlertDescription>
        </Alert>
      )}
      <div className="space-y-1">
        <Label htmlFor="commission">Commission (%)</Label>
        <Input
          id="commission"
          type="number"
          step="0.01"
          min={0}
          max={50}
          value={percent}
          onChange={(e) => setPercent(e.currentTarget.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          Current: {(initial.commissionBps / 100).toFixed(2)}% ({initial.commissionBps} bps).
          Allowed range: 0 to 50 percent.
        </p>
      </div>
      <Button type="submit" disabled={busy}>
        {busy && <Spinner />}
        Save
      </Button>
    </form>
  );
}
