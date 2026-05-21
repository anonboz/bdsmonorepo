import * as React from 'react';

import { cn } from '../lib/cn';

/**
 * Minimal shape an inbox row needs to render. Mirrors `@repo/shared`'s
 * `Notification` but kept structural so this file doesn't depend on
 * the shared package — `@repo/ui` deliberately has no runtime deps on
 * domain schemas (see CLAUDE.md "no business logic").
 */
export interface NotificationInboxItem {
  id: string;
  topic: string;
  title: string;
  body: string | null;
  readAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationInboxListProps {
  items: NotificationInboxItem[];
  /** Empty-state copy. Defaults to a generic "Nothing here yet." */
  emptyText?: string;
  /**
   * Renders each row. Apps provide their own renderer so they can wrap
   * the row in a `<Link href=...>` to the deep-link target inferred
   * from the topic's `data` payload. If omitted, falls back to the
   * read-only default below.
   */
  renderItem?: (item: NotificationInboxItem) => React.ReactNode;
  className?: string;
}

export function NotificationInboxList({
  items,
  emptyText = 'Nothing here yet.',
  renderItem,
  className,
}: NotificationInboxListProps): React.ReactElement {
  if (items.length === 0) {
    return (
      <p
        className={cn(
          'rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        {emptyText}
      </p>
    );
  }
  return (
    <ul className={cn('flex flex-col divide-y rounded-md border', className)}>
      {items.map((item) => (
        <li key={item.id}>{renderItem ? renderItem(item) : <DefaultRow item={item} />}</li>
      ))}
    </ul>
  );
}

export interface NotificationInboxRowProps {
  item: NotificationInboxItem;
  /** Optional href; the row wraps in an anchor when set. */
  href?: string;
  /** Optional click handler — fires before navigation. */
  onClick?: () => void;
  className?: string;
}

/**
 * Reusable row layout used by the default renderer + apps that want
 * to compose their own (with topic-specific deep links).
 */
export function NotificationInboxRow({
  item,
  href,
  onClick,
  className,
}: NotificationInboxRowProps): React.ReactElement {
  const unread = item.readAt == null;
  const content = (
    <div
      className={cn(
        'flex w-full items-start gap-3 p-4',
        unread ? 'bg-accent/40' : 'bg-background',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 inline-block h-2 w-2 flex-none rounded-full',
          unread ? 'bg-destructive' : 'bg-transparent',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3
            className={cn(
              'truncate text-sm',
              unread ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground',
            )}
          >
            {item.title}
          </h3>
          <time
            dateTime={item.createdAt}
            className="flex-none text-xs tabular-nums text-muted-foreground"
          >
            {formatRelative(item.createdAt)}
          </time>
        </div>
        {item.body && (
          <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.body}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground/80">{item.topic}</p>
      </div>
    </div>
  );
  if (href) {
    return (
      <a href={href} onClick={onClick} className="block hover:bg-accent/60">
        {content}
      </a>
    );
  }
  return content;
}

function DefaultRow({ item }: { item: NotificationInboxItem }): React.ReactElement {
  return <NotificationInboxRow item={item} />;
}

/**
 * Compact, locale-aware "x minutes ago" formatter — exported so apps
 * that build their own row can reuse it.
 */
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
