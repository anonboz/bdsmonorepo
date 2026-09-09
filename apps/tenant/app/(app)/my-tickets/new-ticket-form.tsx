"use client";

// Raise a maintenance request on one of the tenant's current leases. Collapsed
// behind a "New request" button; on success the server list is refreshed via
// router.refresh() and the form closes.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTranslations } from "@/i18n/provider";
import type { ApiResponse } from "@repo/shared";
import { Button, Card, CardContent } from "@repo/ui";

const PRIORITIES = ["low", "medium", "high", "emergency"] as const;
type Priority = (typeof PRIORITIES)[number];

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

export function NewTicketForm({ leases }: { leases: { id: string; label: string }[] }) {
  const t = useTranslations("tickets");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [leaseId, setLeaseId] = useState(leases[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(false);
    const res = await fetch("/api/my-tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leaseId,
        title: title.trim(),
        description: description.trim() === "" ? undefined : description.trim(),
        priority,
      }),
    });
    const json = (await res.json()) as ApiResponse<{ id: string }>;
    setPending(false);
    if (!json.success) {
      setError(json.error.message || t("form.error"));
      return;
    }
    reset();
    setOpen(false);
    setSuccess(true);
    router.refresh();
  }

  if (leases.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("form.noLeases")}</p>;
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => {
            setSuccess(false);
            setOpen(true);
          }}
        >
          {t("form.open")}
        </Button>
        {success ? <span className="text-sm text-primary">{t("form.success")}</span> : null}
      </div>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelCls} htmlFor="ticket-lease">
                {t("form.lease")}
              </label>
              <select
                id="ticket-lease"
                value={leaseId}
                onChange={(e) => setLeaseId(e.target.value)}
                className={field}
              >
                {leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelCls} htmlFor="ticket-priority">
                {t("form.priority")}
              </label>
              <select
                id="ticket-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
                className={field}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className={labelCls} htmlFor="ticket-title">
              {t("form.title")}
            </label>
            <input
              id="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              required
              minLength={3}
              maxLength={120}
              className={field}
            />
          </div>

          <div className="space-y-1.5">
            <label className={labelCls} htmlFor="ticket-description">
              {t("form.description")}
            </label>
            <textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("form.descriptionPlaceholder")}
              rows={4}
              maxLength={2000}
              className={field + " h-auto py-2"}
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? t("form.submitting") : t("form.submit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              disabled={pending}
            >
              {t("form.cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
