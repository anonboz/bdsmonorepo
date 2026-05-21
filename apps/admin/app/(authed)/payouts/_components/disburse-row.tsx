'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminPendingPayout, PayoutDisbursementMethod } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Label,
  Spinner,
  Textarea,
} from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';
import { formatMoney } from '../../../../lib/format';

type Method = PayoutDisbursementMethod;

export function DisburseRow({ entry }: { entry: AdminPendingPayout }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [method, setMethod] = useState<Method>('MANUAL_BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!reference.trim()) {
      setError('Reference is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: { method: Method; reference: string; note?: string } = {
        method,
        reference: reference.trim(),
      };
      if (note.trim()) body.note = note.trim();
      await api.post(`/v1/admin/payouts/${entry.id}/disburse`, body);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Failed to mark disbursed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Mark disbursed
      </Button>
    );
  }

  return (
    <form className="space-y-2 rounded-md border p-3" onSubmit={submit}>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not mark disbursed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        Sending {formatMoney(entry.amount, entry.currency)} to{' '}
        <span className="font-medium">{entry.partnerName}</span>.
      </p>
      <div className="grid gap-1">
        <Label htmlFor={`method-${entry.id}`} className="text-xs">
          Method
        </Label>
        <select
          id={`method-${entry.id}`}
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="MANUAL_BANK_TRANSFER">Manual bank transfer</option>
          <option value="STRIPE_CONNECT" disabled>
            Stripe Connect (later phase)
          </option>
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`ref-${entry.id}`} className="text-xs">
          Reference
        </Label>
        <Input
          id={`ref-${entry.id}`}
          placeholder="VietcomBank TXN 12345"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={200}
          required
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`note-${entry.id}`} className="text-xs">
          Note (optional)
        </Label>
        <Textarea
          id={`note-${entry.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy && <Spinner />}
          Confirm
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
