'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  type LeaseRating,
  type LeaseRatingState,
  type RatingMilestone,
  type RatingMilestoneState,
} from '@repo/shared';
import { Button, Spinner, Textarea } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';
import { formatDate } from '../../../../../../../../../lib/format';

const MILESTONE_TITLES: Record<RatingMilestone, string> = {
  MOVE_IN: 'Move-in',
  MID_LEASE: 'Mid-lease check-in',
  MOVE_OUT: 'Move-out',
};

const MILESTONE_BLURBS: Record<RatingMilestone, string> = {
  MOVE_IN: 'How was the handover — paperwork, deposit, condition?',
  MID_LEASE: 'How is the tenant doing — payments, care of the place?',
  MOVE_OUT: 'How was the exit — condition, deposit settlement?',
};

/**
 * Mirrors apps/tenant/.../ratings-card.tsx. Kept duplicated rather than in
 * @repo/ui because the rule is "promote on the third app that needs it" and
 * the API/business shape differs slightly between sides.
 */
export function RatingsCard({
  state,
  submitPath,
}: {
  state: LeaseRatingState;
  submitPath: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tell future owners what to expect from this tenant. One rating per milestone.
      </p>
      <ul className="space-y-4">
        {state.milestones.map((m) => (
          <MilestoneRow key={m.milestone} state={m} submitPath={submitPath} />
        ))}
      </ul>
    </div>
  );
}

function MilestoneRow({ state, submitPath }: { state: RatingMilestoneState; submitPath: string }) {
  return (
    <li className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{MILESTONE_TITLES[state.milestone]}</h3>
          <p className="text-xs text-muted-foreground">{MILESTONE_BLURBS[state.milestone]}</p>
        </div>
        <Pill state={state} />
      </div>
      <div className="mt-3">
        {state.alreadyRated ? (
          <p className="text-sm text-muted-foreground">Thanks — you&apos;ve already rated this.</p>
        ) : state.isOpen ? (
          <RatingForm submitPath={submitPath} milestone={state.milestone} />
        ) : (
          <p className="text-sm text-muted-foreground">{notOpenCopy(state)}</p>
        )}
      </div>
    </li>
  );
}

function Pill({ state }: { state: RatingMilestoneState }) {
  if (state.alreadyRated) {
    return <Badge className="bg-emerald-100 text-emerald-900">rated</Badge>;
  }
  if (state.isOpen) {
    return <Badge className="bg-sky-100 text-sky-900">open</Badge>;
  }
  return <Badge className="bg-slate-100 text-slate-700">not yet</Badge>;
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

function notOpenCopy(state: RatingMilestoneState): string {
  if (state.reason === 'LEASE_DRAFT') return 'Available once the lease is activated.';
  if (state.reason === 'LEASE_NOT_ENDED')
    return 'Available when the lease ends or the move-out date passes.';
  if (state.opensAt) return `Opens ${formatDate(state.opensAt)}.`;
  return 'Not yet available.';
}

function RatingForm({ submitPath, milestone }: { submitPath: string; milestone: RatingMilestone }) {
  const router = useRouter();
  const [score, setScore] = useState<number>(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (score < 1 || score > 5) {
      setError('Pick a score from 1 to 5.');
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
      setError(err instanceof ApiError ? err.problem.title : 'Could not submit rating.');
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <StarPicker value={score} onChange={setScore} disabled={busy} />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment (≤ 2000 characters)"
        rows={2}
        maxLength={2000}
        disabled={busy}
        aria-label="Comment"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-destructive" role="alert" aria-live="polite">
          {error}
        </p>
        <Button type="submit" disabled={busy || score === 0}>
          {busy && <Spinner />}
          Submit
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
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Score">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
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
