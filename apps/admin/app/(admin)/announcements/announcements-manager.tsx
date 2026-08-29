"use client";

// Create + manage platform-wide announcements. The form POSTs to the API; the
// list toggles publish state (PATCH) and deletes (DELETE). All writes are
// re-validated + admin-gated server-side; we just refresh on success.

import { Button, Card, CardContent } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type Row = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function CreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [publishNow, setPublishNow] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, publishNow }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to create");
      return;
    }
    setTitle("");
    setBody("");
    setPublishNow(true);
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="py-6">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
              placeholder="Scheduled maintenance this weekend"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className={inputClass + " h-auto py-2"}
              placeholder="Details tenants should know…"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={publishNow}
              onChange={(e) => setPublishNow(e.target.checked)}
            />
            Publish immediately
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={pending || !title.trim() || !body.trim()}>
            {pending ? "Creating…" : "Create announcement"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RowItem({ row }: { row: Row }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function togglePublish() {
    setPending(true);
    await fetch(`/api/admin/announcements/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ published: !row.published }),
    });
    setPending(false);
    router.refresh();
  }

  async function remove() {
    setPending(true);
    await fetch(`/api/admin/announcements/${row.id}`, { method: "DELETE" });
    setPending(false);
    router.refresh();
  }

  return (
    <div className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={
              row.published
                ? "inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
                : "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            }
          >
            {row.published ? "Published" : "Draft"}
          </span>
          <h3 className="truncate font-medium">{row.title}</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{row.body}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={togglePublish}
          disabled={pending}
        >
          {row.published ? "Unpublish" : "Publish"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={pending}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function AnnouncementsManager({ initialRows }: { initialRows: Row[] }) {
  return (
    <div className="space-y-6">
      <CreateForm />
      <Card>
        <CardContent className="p-0">
          {initialRows.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No announcements yet.
            </p>
          ) : (
            initialRows.map((row) => <RowItem key={row.id} row={row} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
