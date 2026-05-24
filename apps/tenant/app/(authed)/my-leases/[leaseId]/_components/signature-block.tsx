'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useFormatters } from '@repo/i18n';
import type { Signature, SignatureRole } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { SignaturePad } from './signature-pad';
import { ApiError, api } from '../../../../../lib/api';

/**
 * Phase 12.3 — Tenant-side signature block. Mounts on the tenant
 * lease-detail page when `lease.status === 'AWAITING_SIGNATURES'`.
 *
 * Fetches signatures client-side (avoids ballooning the server-side
 * Lease response). Shows the pad when the tenant hasn't signed yet;
 * shows a "you signed on X" confirmation otherwise.
 */
export function SignatureBlock({ leaseId }: { leaseId: string }) {
  const t = useTranslations('tenant.leases.signatures');
  const { formatDate } = useFormatters();
  const [signatures, setSignatures] = useState<Signature[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataUri, setDataUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Signature[]>(`/v1/me/leases/${leaseId}/signatures`)
      .then((rows) => {
        if (!cancelled) setSignatures(rows);
      })
      .catch(() => {
        if (!cancelled) setSignatures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [leaseId]);

  if (signatures === null) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  const tenantSig = signatures.find((s) => s.role === ('TENANT' as SignatureRole));
  const ownerSig = signatures.find((s) => s.role === ('OWNER' as SignatureRole));

  async function submit() {
    if (!dataUri) return;
    setPending(true);
    setError(null);
    try {
      const next = await api.post<Signature>(`/v1/me/leases/${leaseId}/signatures`, {
        imageDataUri: dataUri,
      });
      setSignatures((prev) => {
        const others = (prev ?? []).filter((s) => s.role !== next.role);
        return [...others, next];
      });
      // Hard reload so the lease page re-fetches the updated status
      // (it may have auto-flipped to ACTIVE after this signature).
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('submitFailed'));
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('ownerStatusLabel')}</p>
        <p className="text-sm">
          {ownerSig ? t('signedOn', { date: formatDate(ownerSig.signedAt) }) : t('waitingForOwner')}
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">{t('yourStatusLabel')}</p>
        {tenantSig ? (
          <p className="text-sm">{t('youSignedOn', { date: formatDate(tenantSig.signedAt) })}</p>
        ) : (
          <>
            <SignaturePad onChange={setDataUri} ariaLabel={t('padAria')} />
            {error && (
              <Alert variant="destructive">
                <AlertTitle>{t('submitFailedTitle')}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button onClick={submit} disabled={!dataUri || pending}>
              {pending && <Spinner />}
              {t('submit')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
