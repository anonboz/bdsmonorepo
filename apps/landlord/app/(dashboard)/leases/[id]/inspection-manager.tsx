"use client";

// Condition records (move-in / move-out inspections) for one lease: create a
// record, edit its notes, attach or remove photos, delete it. Photos upload on
// selection (no separate save step), matching the listing photo gallery.

import { Button, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { InspectionRow } from "@/services/inspection.service";
import type { InspectionKind } from "@repo/shared";

const TYPE_LABELS: Record<InspectionKind, string> = {
  move_in: "Move-in",
  move_out: "Move-out",
  routine: "Routine",
  maintenance: "Maintenance",
};

type ApiJson<T> = { success: true; data: T } | { success: false; error?: { message?: string } };

export function InspectionManager({
  leaseId,
  initialInspections,
  canEdit,
}: {
  leaseId: string;
  initialInspections: InspectionRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [inspections, setInspections] = useState(initialInspections);
  const [creating, setCreating] = useState<InspectionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreate(type: InspectionKind) {
    setCreating(type);
    setError(null);
    const res = await fetch(`/api/leases/${leaseId}/inspections`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    const json = (await res.json()) as ApiJson<InspectionRow>;
    setCreating(null);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to record inspection");
      return;
    }
    setInspections((prev) => [...prev, json.data]);
    router.refresh();
  }

  async function onDelete(id: string) {
    if (!window.confirm("Delete this record and all its photos? This can't be undone.")) return;
    setError(null);
    const res = await fetch(`/api/inspections/${id}`, { method: "DELETE" });
    const json = (await res.json()) as ApiJson<{ id: string }>;
    if (!json.success) {
      setError(json.error?.message ?? "Failed to delete record");
      return;
    }
    setInspections((prev) => prev.filter((i) => i.id !== id));
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Condition records</h2>
          <p className="text-sm text-muted-foreground">
            Photos and notes of the unit&apos;s state at move-in and move-out. Tenants see these on
            their lease page.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCreate("move_in")}
              disabled={creating !== null}
            >
              {creating === "move_in" ? "Adding…" : "Add move-in record"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCreate("move_out")}
              disabled={creating !== null}
            >
              {creating === "move_out" ? "Adding…" : "Add move-out record"}
            </Button>
          </div>
        )}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {inspections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No condition records yet. Add a move-in record and attach photos before the tenant moves
            in.
          </CardContent>
        </Card>
      ) : (
        inspections.map((inspection) => (
          <InspectionCard
            key={inspection.id}
            inspection={inspection}
            canEdit={canEdit}
            onChange={(updated) =>
              setInspections((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
            }
            onDelete={() => onDelete(inspection.id)}
          />
        ))
      )}
    </section>
  );
}

function InspectionCard({
  inspection,
  canEdit,
  onChange,
  onDelete,
}: {
  inspection: InspectionRow;
  canEdit: boolean;
  onChange: (updated: InspectionRow) => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(inspection.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirty = notes !== (inspection.notes ?? "");

  async function saveNotes() {
    setSavingNotes(true);
    setError(null);
    const res = await fetch(`/api/inspections/${inspection.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: notes.trim() === "" ? null : notes.trim() }),
    });
    const json = (await res.json()) as ApiJson<InspectionRow>;
    setSavingNotes(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to save notes");
      return;
    }
    onChange(json.data);
    setSaved(true);
    router.refresh();
  }

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file later
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    let current = inspection;
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/inspections/${inspection.id}/photos`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as ApiJson<InspectionRow["photos"][number]>;
      if (!json.success) {
        setError(json.error?.message ?? `Failed to upload ${file.name}`);
        break;
      }
      current = { ...current, photos: [...current.photos, json.data] };
      onChange(current);
    }
    setUploading(false);
    router.refresh();
  }

  async function removePhoto(photoId: string) {
    setDeletingPhotoId(photoId);
    setError(null);
    const res = await fetch(`/api/inspections/${inspection.id}/photos/${photoId}`, {
      method: "DELETE",
    });
    const json = (await res.json()) as ApiJson<{ id: string }>;
    setDeletingPhotoId(null);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to delete photo");
      return;
    }
    onChange({ ...inspection, photos: inspection.photos.filter((p) => p.id !== photoId) });
    router.refresh();
  }

  const recordedAt = new Date(inspection.completedAt ?? inspection.createdAt);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-lg">{TYPE_LABELS[inspection.type]} inspection</CardTitle>
          <p className="text-sm text-muted-foreground">
            Recorded {format(recordedAt, "MMM d, yyyy")} · {inspection.photos.length} photo
            {inspection.photos.length === 1 ? "" : "s"}
          </p>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={onDelete}>
            Delete
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {canEdit ? (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor={`notes-${inspection.id}`}>
              Notes
            </label>
            <textarea
              id={`notes-${inspection.id}`}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSaved(false);
              }}
              rows={3}
              placeholder="Walls, floors, appliances, existing damage…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={saveNotes} disabled={!dirty || savingNotes}>
                {savingNotes ? "Saving…" : "Save notes"}
              </Button>
              {saved && !dirty ? <span className="text-sm text-primary">Saved</span> : null}
            </div>
          </div>
        ) : inspection.notes ? (
          <p className="whitespace-pre-line text-sm">{inspection.notes}</p>
        ) : null}

        {canEdit && (
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={onFilesSelected}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Add photos"}
            </Button>
          </div>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {inspection.photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos attached yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {inspection.photos.map((photo) => (
              <div key={photo.id} className="group relative overflow-hidden rounded-md border">
                <a href={photo.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
                </a>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    disabled={deletingPhotoId === photo.id}
                    className="absolute right-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-destructive opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-60"
                  >
                    {deletingPhotoId === photo.id ? "Removing…" : "Remove"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
