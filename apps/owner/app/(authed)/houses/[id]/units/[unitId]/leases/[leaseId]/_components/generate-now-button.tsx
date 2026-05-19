'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Bill } from '@repo/shared';
import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';

interface Props {
  houseId: string;
  unitId: string;
  leaseId: string;
}

export function GenerateNowButton({ houseId, unitId, leaseId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function handle() {
    setBusy(true);
    setMsg(null);
    try {
      const result = await api.post<{ bill: Bill; status: 'created' | 'idempotent' }>(
        `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/generate-now`,
        {},
      );
      setMsg(result.status === 'created' ? 'Bill generated' : 'Already generated this period');
      router.refresh();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.problem.title : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        Generate now
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
