'use client';

import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [own, setOwn] = useState<JobRating | null>(initial.partnerToOwner);
  const [score, setScore] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (score < 1) {
      setError('Pick a score from 1 to 5.');
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
      setError(err instanceof ApiError ? err.problem.title : 'Submit failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {own ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">You rated the owner {own.score}★</p>
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
              <AlertTitle>Rating failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Rate the owner</legend>
            <div className="flex gap-1" role="radiogroup" aria-label="Score 1-5">
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
            placeholder="Comment (optional)"
            maxLength={2000}
            rows={3}
          />
          <Button type="submit" disabled={busy}>
            {busy && <Spinner />}
            Submit rating
          </Button>
        </form>
      )}

      {initial.ownerToPartner && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">
            {initial.ownerToPartner.raterName} rated you {initial.ownerToPartner.score}★
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
