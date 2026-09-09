"use client";

// Bell + unread badge in the app shell. Seeded with the server-rendered count,
// then kept fresh by polling (no push/realtime channel yet). The inbox page
// invalidates UNREAD_COUNT_QUERY_KEY after marking rows read.

import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";

import type { ApiResponse } from "@repo/shared";
import { cn } from "@repo/ui";

export const UNREAD_COUNT_QUERY_KEY = ["notifications", "unread-count"] as const;

async function fetchUnreadCount(): Promise<number> {
  const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
  const json = (await res.json()) as ApiResponse<{ unread: number }>;
  if (!json.success) throw new Error(json.error.message);
  return json.data.unread;
}

export function NotificationBell({
  initialUnread,
  className,
}: {
  initialUnread: number;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: UNREAD_COUNT_QUERY_KEY,
    queryFn: fetchUnreadCount,
    initialData: initialUnread,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const unread = data ?? 0;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className={cn(
        "relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        className,
      )}
    >
      <Bell className="h-5 w-5" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
