'use client';

import { useRouter } from 'next/navigation';
import { type useTranslations as useTranslationsType, useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormatters } from '@repo/i18n';
import {
  type LeaseRating,
  type LeaseRatingState,
  type RatingMilestone,
  type RatingMilestoneState,
} from '@repo/shared';
import { Button, Spinner, Textarea } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';

type Translator = ReturnType<typeof useTranslationsType>;

/**
 * Owner-side rating card. Mirrors the tenant equivalent — owner rates
 * the tenant, copy says "future owners".
 */
export function RatingsCard({
  state,
  submitPath,
}: {
  state: LeaseRatingState;
  submitPath: string;
}) {
  const t = useTranslations('owner.leases.ratings');
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('lead')}</p>
      <ul className="space-y-4">
        {state.milestones.map((m) => (
          <MilestoneRow key={m.milestone} state={m} submitPath={submitPath} />
        ))}
      </ul>
    </div>
  );
}

function MilestoneRow({ state, submitPath }: { state: RatingMilestoneState; submitPath: string }) {
  const t = useTranslations('owner.leases.ratings');
  const tMilestone = useTranslations('owner.leases.ratings.milestones');
  const tBlurb = useTranslations('owner.leases.ratings.blurbs');
  const { formatDate } = useFormatters();
  return (
    <li className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{tMilestone(state.milestone)}</h3>
          <p className="text-xs text-muted-foreground">{tBlurb(state.milestone)}</p>
        </div>
        <Pill state={state} />
      </div>
      <div className="mt-3">
        {state.alreadyRated ? (
          <p className="text-sm text-muted-foreground">{t('alreadyRated')}</p>
        ) : state.isOpen ? (
          <RatingForm submitPath={submitPath} milestone={state.milestone} />
        ) : (
          <p className="text-sm text-muted-foreground">{notOpenCopy(state, t, formatDate)}</p>
        )}
      </div>
    </li>
  );
}

function Pill({ state }: { state: RatingMilestoneState }) {
  const t = useTranslations('owner.leases.ratings');
  if (state.alreadyRated) {
    return <Badge className="bg-emerald-100 text-emerald-900">{t('pillRated')}</Badge>;
  }
  if (state.isOpen) {
    return <Badge className="bg-sky-100 text-sky-900">{t('pillOpen')}</Badge>;
  }
  return <Badge className="bg-slate-100 text-slate-700">{t('pillNotYet')}</Badge>;
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function notOpenCopy(
  state: RatingMilestoneState,
  t: Translator,
  formatDate: (iso: string | null | undefined) => string,
): string {
  if (state.reason === 'LEASE_DRAFT') return t('notAvailableDraft');
  if (state.reason === 'LEASE_NOT_ENDED') return t('notAvailableNotEnded');
  if (state.opensAt) return t('opensAt', { date: formatDate(state.opensAt) });
  return t('notAvailableGeneric');
}

function RatingForm({ submitPath, milestone }: { submitPath: string; milestone: RatingMilestone }) {
  const t = useTranslations('owner.leases.ratings');
  const router = useRouter();
  const [score, setScore] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (score < 1 || score > 5) {
      setError(t('pickScoreError'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { milestone, score };
      if (comment.trim()) body.comment = comment.trim();
      await api.post<LeaseRating>(submitPath, body);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('submitFailed'));
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <StarPicker value={score} onChange={setScore} disabled={busy} />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t('commentPlaceholder')}
        rows={2}
        maxLength={2000}
        disabled={busy}
        aria-label={t('commentAria')}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
        <Button type="submit" disabled={busy || score === 0}>
          {busy && <Spinner />}
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('owner.leases.ratings');
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t('scoreAria')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t('starsAria', { n })}
          onClick={() => onChange(n)}
          disabled={disabled}
          className={`h-9 w-9 rounded-md border text-lg leading-none transition-colors ${
            n <= value
              ? 'border-amber-400 bg-amber-50 text-amber-600'
              : 'border-input text-muted-foreground hover:border-foreground/20'
          }`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
