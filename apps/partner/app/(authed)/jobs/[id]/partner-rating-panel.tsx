'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { JobRating, JobRatingsForJob } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner, Textarea } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

const STAR_VALUES = [1, 2, 3, 4, 5] as const;

export function PartnerRatingPanel({
  jobId,
  initial,
}: {
  jobId: string;
  initial: JobRatingsForJob;
}) {
  const t = useTranslations('partner.jobs.rating');
  const router = useRouter();
  const [own, setOwn] = useState<JobRating | null>(initial.partnerToOwner);
  const [score, setScore] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (score < 1) {
      setError(t('pickScoreError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const trimmed = comment.trim();
      const created = await api.post<JobRating>(`/v1/me/jobs/${jobId}/rating`, {
        score,
        ...(trimmed.length > 0 && { comment: trimmed }),
      });
      setOwn(created);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('submitFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {own ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">
            {t('ownPrefix', { score: own.score })}
          </p>
          {own.comment && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900">
              {own.comment}
            </p>
          )}
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t('failedTitle')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('submitTitle')}</legend>
            <div className="flex gap-1" role="radiogroup" aria-label={t('scoreAria')}>
              {STAR_VALUES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={score === n}
                  onClick={() => setScore(n)}
                  className={`h-10 w-10 rounded-md border text-lg font-semibold transition-colors ${
                    score >= n
                      ? 'border-amber-400 bg-amber-100 text-amber-900'
                      : 'border-input hover:border-foreground/30'
                  }`}
                >
                  ★
                </button>
              ))}
            </div>
          </fieldset>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('commentPlaceholder')}
            maxLength={2000}
            rows={3}
          />
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            {t('submitButton')}
          </Button>
        </form>
      )}

      {initial.ownerToPartner && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            {t('otherRatedYou', {
              name: initial.ownerToPartner.raterName,
              score: initial.ownerToPartner.score,
            })}
          </p>
          {initial.ownerToPartner.comment && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {initial.ownerToPartner.comment}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
