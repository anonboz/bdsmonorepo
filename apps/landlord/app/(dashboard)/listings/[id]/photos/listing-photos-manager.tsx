"use client";

// Add/remove photos for one listing. Selecting a file uploads it immediately
// (no separate "save" step) — this is a standalone gallery, not a form field.

import { Button, Card, CardContent } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { ListingPhotoRow } from "@/services/listing.service";

export function ListingPhotosManager({
  listingId,
  initialPhotos,
}: {
  listingId: string;
  initialPhotos: ListingPhotoRow[];
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState(initialPhotos);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/listings/${listingId}/photos`, { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to upload photo");
      return;
    }
    setPhotos((prev) => [...prev, json.data]);
    router.refresh(); // keeps the listings index photo count in sync
  }

  async function onDelete(photoId: string) {
    setDeletingId(photoId);
    setError(null);
    const res = await fetch(`/api/listings/${listingId}/photos/${photoId}`, { method: "DELETE" });
    const json = await res.json();
    setDeletingId(null);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to delete photo");
      return;
    }
    setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileSelected}
          className="hidden"
        />
        <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Add photo"}
        </Button>
        <span className="text-sm text-muted-foreground">
          {photos.length} photo{photos.length === 1 ? "" : "s"}
        </span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {photos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No photos yet. Add one to show it on the public listing.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative overflow-hidden rounded-md border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" className="aspect-square w-full object-cover" />
              <button
                type="button"
                onClick={() => onDelete(photo.id)}
                disabled={deletingId === photo.id}
                className="absolute right-2 top-2 rounded-md bg-background/90 px-2 py-1 text-xs font-medium text-destructive opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-60"
              >
                {deletingId === photo.id ? "Removing…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
