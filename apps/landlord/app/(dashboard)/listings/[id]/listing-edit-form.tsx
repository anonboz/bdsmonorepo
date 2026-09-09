"use client";

// Edit a listing's fields and status, or delete it. Status changes go through
// the same PATCH as field edits — the service stamps publishedAt on first
// publish and leaves it alone after that.

import { parseMoneyToCents } from "@repo/shared";
import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { OrgListingDetail } from "@/services/listing.service";

const STATUSES = ["draft", "published", "paused", "rented", "archived"] as const;
const STATUS_LABELS: Record<(typeof STATUSES)[number], string> = {
  draft: "Draft",
  published: "Published",
  paused: "Paused",
  rented: "Rented",
  archived: "Archived",
};

function centsToMajor(cents: number): string {
  return String(cents / 100);
}

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

export function ListingEditForm({ listing }: { listing: OrgListingDetail }) {
  const router = useRouter();
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description ?? "");
  const [rentAmount, setRentAmount] = useState(centsToMajor(listing.rentAmount));
  const [depositAmount, setDepositAmount] = useState(centsToMajor(listing.depositAmount));
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(
    listing.status as (typeof STATUSES)[number],
  );
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    let rentCents: number;
    let depositCents: number;
    try {
      rentCents = parseMoneyToCents(rentAmount);
      depositCents = parseMoneyToCents(depositAmount);
    } catch {
      setPending(false);
      setError("Enter valid amounts");
      return;
    }
    const res = await fetch(`/api/listings/${listing.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title,
        description: description.trim() === "" ? null : description.trim(),
        rentAmount: rentCents,
        depositAmount: depositCents,
        status,
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to save");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function onDelete() {
    if (!window.confirm("Delete this listing and all its photos? This can't be undone.")) return;
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/listings/${listing.id}`, { method: "DELETE" });
    const json = await res.json();
    if (!json.success) {
      setDeleting(false);
      setError(json.error?.message ?? "Failed to delete");
      return;
    }
    router.push("/listings");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1.5">
        <label className={labelCls}>Title</label>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
          required
          className={field}
        />
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Description</label>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
          rows={4}
          className={field + " h-auto py-2"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className={labelCls}>Monthly rent</label>
          <input
            type="number"
            min={0}
            step="any"
            value={rentAmount}
            onChange={(e) => {
              setRentAmount(e.target.value);
              setSaved(false);
            }}
            required
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Deposit</label>
          <input
            type="number"
            min={0}
            step="any"
            value={depositAmount}
            onChange={(e) => {
              setDepositAmount(e.target.value);
              setSaved(false);
            }}
            required
            className={field}
          />
        </div>
        <div className="space-y-1.5">
          <label className={labelCls}>Status</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as typeof status);
              setSaved(false);
            }}
            className={field}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
        {saved ? <span className="text-sm text-primary">Saved</span> : null}
        <Button
          type="button"
          variant="destructive"
          className="ml-auto"
          onClick={onDelete}
          disabled={deleting}
        >
          {deleting ? "Deleting…" : "Delete listing"}
        </Button>
      </div>
    </form>
  );
}
