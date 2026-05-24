'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { useFormatters } from '@repo/i18n';
import type { Signature, SignatureRole } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { SignaturePad } from './signature-pad';
import { ApiError, api } from '../../../../../../../../../lib/api';

/**
 * Phase 12.3 — Owner-side signature block. Mounts on the owner
 * lease-detail page when `lease.status === 'AWAITING_SIGNATURES'`
 * (and read-only on `ACTIVE` to show the captured signatures for
 * audit / dispute).
 */
export function SignatureBlock({
  houseId,
  unitId,
  leaseId,
  readOnly = false,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  readOnly?: boolean;
}) {
  const t = useTranslations('owner.leases.signatures');
  const { formatDate } = useFormatters();
  const [signatures, setSignatures] = useState<Signature[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataUri, setDataUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Signature[]>(`/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/signatures`)
      .then((rows) => {
        if (!cancelled) setSignatures(rows);
      })
      .catch(() => {
        if (!cancelled) setSignatures([]);
      });
    return () => {
      cancelled = true;
    };
  }, [houseId, unitId, leaseId]);

  if (signatures === null) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  const ownerSig = signatures.find((s) => s.role === ('OWNER' as SignatureRole));
  const tenantSig = signatures.find((s) => s.role === ('TENANT' as SignatureRole));

  async function submit() {
    if (!dataUri) return;
    setPending(true);
    setError(null);
    try {
      const next = await api.post<Signature>(
        `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/signatures`,
        { imageDataUri: dataUri },
      );
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

  if (readOnly) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyCell
          label={t('ownerStatusLabel')}
          sig={ownerSig}
          fallback={t('notSigned')}
          formatDate={formatDate}
        />
        <ReadOnlyCell
          label={t('tenantStatusLabel')}
          sig={tenantSig}
          fallback={t('notSigned')}
          formatDate={formatDate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="text-xs font-medium text-muted-foreground">{t('tenantStatusLabel')}</p>
        <p className="text-sm">
          {tenantSig
            ? t('signedOn', { date: formatDate(tenantSig.signedAt) })
            : t('waitingForTenant')}
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
        <p className="text-xs font-medium text-muted-foreground">{t('yourStatusLabel')}</p>
        {ownerSig ? (
          <p className="text-sm">{t('youSignedOn', { date: formatDate(ownerSig.signedAt) })}</p>
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

function ReadOnlyCell({
  label,
  sig,
  fallback,
  formatDate,
}: {
  label: string;
  sig: Signature | undefined;
  fallback: string;
  formatDate: (iso: string | null | undefined) => string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {sig ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sig.imageDataUri}
            alt=""
            className="mt-2 max-h-16 w-full rounded border bg-background object-contain"
          />
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(sig.signedAt)}</p>
        </>
      ) : (
        <p className="text-sm">{fallback}</p>
      )}
    </div>
  );
}
