import * as React from 'react';

import { cn } from '../lib/cn';

export interface NotificationBellProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Count of unread notifications. The dot/badge only renders when > 0. */
  unreadCount: number;
  /**
   * Cap the visible count — anything past `max` renders as `${max}+`.
   * Default 9 (matches typical mobile badge UX).
   */
  max?: number;
  /** Aria label override; defaults to a localized "N unread notifications". */
  label?: string;
}

/**
 * Bell icon + optional unread badge. Pure presentation: the parent
 * app fetches `unreadCount` and decides whether to wrap the bell in a
 * link. Designed to render inside an `<a>` or `<button>`.
 */
export const NotificationBell = React.forwardRef<HTMLSpanElement, NotificationBellProps>(
  ({ unreadCount, max = 9, label, className, ...props }, ref) => {
    const safeCount = Math.max(0, Math.floor(unreadCount));
    const display = safeCount > max ? `${max}+` : String(safeCount);
    const ariaLabel = label ?? `${safeCount} unread notifications`;
    return (
      <span
        ref={ref}
        role="img"
        aria-label={ariaLabel}
        className={cn('relative inline-flex h-9 w-9 items-center justify-center', className)}
        {...props}
      >
        <BellIcon />
        {safeCount > 0 && (
          <span
            data-testid="notification-bell-badge"
            className="absolute -right-0.5 -top-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
          >
            {display}
          </span>
        )}
      </span>
    );
  },
);
NotificationBell.displayName = 'NotificationBell';

function BellIcon(): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
