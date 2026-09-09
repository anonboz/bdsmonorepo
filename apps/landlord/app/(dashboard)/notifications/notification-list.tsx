"use client";

// Inbox rows + "mark all read". Marking read PATCHes/POSTs the API, drops the
// bell's cached count, and re-renders the server-fetched list.

import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CheckCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { isNotificationType, type NotificationType } from "@repo/shared";
import { Button, Card, CardContent, cn } from "@repo/ui";
import { UNREAD_COUNT_QUERY_KEY } from "../_components/notification-bell";

export type NotificationListRow = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: string | null; // ISO
  createdAt: string; // ISO
};

const TYPE_LABELS: Record<NotificationType, string> = {
  invoice_created: "Invoice",
  lease_created: "Lease",
  announcement_published: "Announcement",
  maintenance_request_created: "Maintenance request",
};

export function NotificationList({
  rows,
  unreadCount,
}: {
  rows: NotificationListRow[];
  unreadCount: number;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_QUERY_KEY });
    router.refresh();
  };

  const markRead = async (id: string) => {
    await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    refresh();
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-primary">
          {unreadCount > 0 ? `${unreadCount} unread` : " "}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={markAllRead}
          disabled={busy || unreadCount === 0}
        >
          <CheckCheck />
          Mark all as read
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            You&apos;re all caught up.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {rows.map((n) => {
                const unread = n.readAt === null;
                const typeLabel = isNotificationType(n.type) ? TYPE_LABELS[n.type] : n.type;
                const inner = (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-2 h-2 w-2 shrink-0 rounded-full",
                        unread ? "bg-primary" : "bg-transparent",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                          {typeLabel}
                        </span>
                        <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>
                          {n.title}
                        </span>
                        {unread && <span className="sr-only">Unread</span>}
                      </span>
                      {n.body && (
                        <span className="mt-1 block text-sm text-muted-foreground">{n.body}</span>
                      )}
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {format(new Date(n.createdAt), "MMM d, yyyy HH:mm")}
                      </span>
                    </span>
                  </>
                );
                const rowClass = cn(
                  "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  unread && "bg-primary/5",
                );
                return (
                  <li key={n.id}>
                    {n.deepLink ? (
                      <Link
                        href={n.deepLink as Route}
                        onClick={() => {
                          if (unread) void markRead(n.id);
                        }}
                        className={rowClass}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (unread) void markRead(n.id);
                        }}
                        disabled={!unread}
                        className={cn(rowClass, "disabled:cursor-default")}
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
