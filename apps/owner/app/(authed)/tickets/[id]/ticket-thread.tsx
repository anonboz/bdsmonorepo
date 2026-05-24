'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import type { TicketMessage } from '@repo/shared';
import { Button, Spinner, Textarea } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';
import { formatDateTime } from '../../../../lib/format';

/**
 * Owner-side ticket message thread. Mirrors the tenant component
 * (apps/tenant/.../ticket-thread.tsx).
 */
export function TicketThread({
  ticketId,
  basePath,
  viewerRole,
  viewerId,
  canPost,
  lockedReason,
  initialItems,
}: {
  ticketId: string;
  basePath: string;
  viewerRole: 'TENANT' | 'OWNER';
  viewerId: string;
  canPost: boolean;
  lockedReason?: string;
  initialItems: TicketMessage[];
}) {
  const t = useTranslations('owner.tickets.thread');
  const [items, setItems] = useState(initialItems);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<TicketMessage>(`${basePath}/${ticketId}/messages`, {
        body: trimmed,
      });
      setItems((prev) => [...prev, created]);
      setBody('');
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('sendFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        ref={listRef}
        className="max-h-[26rem] overflow-y-auto rounded-md border bg-muted/30 p-3"
        aria-label={t('convoAria')}
      >
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                mine={m.authorId === viewerId}
                viewerRole={viewerRole}
              />
            ))}
          </ul>
        )}
      </div>

      {canPost ? (
        <form className="space-y-2" onSubmit={send}>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('placeholder')}
            rows={3}
            maxLength={4000}
            disabled={busy}
            aria-label={t('messageAria')}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-destructive" role="alert" aria-live="polite">
              {error}
            </p>
            <Button type="submit" disabled={busy || !body.trim()}>
              {busy && <Spinner />}
              {t('send')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          {lockedReason ?? t('lockedDefault')}
        </p>
      )}
    </div>
  );
}

function MessageBubble({
  message,
  mine,
  viewerRole,
}: {
  message: TicketMessage;
  mine: boolean;
  viewerRole: 'TENANT' | 'OWNER';
}) {
  const tRole = useTranslations('owner.statuses.rolesLower');
  const roleLabel = tRole(message.authorRole === viewerRole ? viewerRole : message.authorRole);
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          mine ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'
        }`}
      >
        <div
          className={`mb-1 flex items-center gap-2 text-xs ${
            mine ? 'text-primary-foreground/80' : 'text-muted-foreground'
          }`}
        >
          <span className="font-medium">{message.authorName}</span>
          <span>·</span>
          <span>{roleLabel}</span>
          <span>·</span>
          <span>{formatDateTime(message.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
      </div>
    </li>
  );
}
