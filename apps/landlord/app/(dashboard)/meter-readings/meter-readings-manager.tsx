"use client";

// Record + browse meter readings per unit. A photo can be attached as evidence
// before submitting; consumption is computed server-side as the delta from the
// unit's previous reading for the same utility, never typed in by hand.

import { Button } from "@repo/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { MeterReadingRow, UnitOption } from "@/services/meter-reading.service";

type Kind = "water" | "electricity";

const KIND_LABEL: Record<Kind, string> = { water: "Water", electricity: "Electricity" };
const KIND_UNIT: Record<Kind, string> = { water: "m³", electricity: "kWh" };

function isoFromDate(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, for <input type="date">
}

const field =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelCls = "text-sm font-medium";

function RecordForm({
  units,
  rows,
  onCreated,
}: {
  units: UnitOption[];
  rows: MeterReadingRow[];
  onCreated: () => void;
}) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("water");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today);
  const [isReset, setIsReset] = useState(false);
  const [note, setNote] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rows are sorted most-recent-first by the service, so the first match for
  // this unit+kind is the reading a new one would be diffed against.
  const lastReading = rows.find((r) => r.unitId === unitId && r.kind === kind) ?? null;
  const diff =
    value !== "" && !Number.isNaN(Number(value)) && lastReading != null
      ? Math.round((Number(value) - lastReading.value) * 100) / 100
      : null;

  async function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file || !unitId) return;
    setUploading(true);
    setError(null);
    setPhotoName(file.name);
    const form = new FormData();
    form.append("file", file);
    form.append("unitId", unitId);
    const res = await fetch("/api/meter-readings/upload", { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to upload photo");
      setPhotoName(null);
      return;
    }
    setPhotoUrl(json.data.url);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/meter-readings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        unitId,
        kind,
        value: Number(value),
        readingDate: isoFromDate(date),
        isReset,
        note: note.trim() === "" ? undefined : note.trim(),
        photoUrl: photoUrl ?? undefined,
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to record reading");
      return;
    }
    setValue("");
    setNote("");
    setPhotoUrl(null);
    setPhotoName(null);
    setIsReset(false);
    onCreated();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 border-b pb-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="unit" className={labelCls}>
            Unit
          </label>
          <select
            id="unit"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            required
            className={field}
          >
            {units.length === 0 && <option value="">No units</option>}
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.propertyName} · {u.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="kind" className={labelCls}>
            Utility
          </label>
          <select
            id="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            className={field}
          >
            <option value="water">Water</option>
            <option value="electricity">Electricity</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className={labelCls}>Meter photo (optional)</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onPhotoSelected}
          disabled={!unitId}
          className="hidden"
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={!unitId || uploading}
          >
            {uploading ? "Uploading…" : photoUrl ? "Replace photo" : "Upload photo"}
          </Button>
          {photoName && !uploading && (
            <span className="text-xs text-muted-foreground">{photoName}</span>
          )}
        </div>
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt="Meter reading"
            className="h-24 w-24 rounded-md border object-cover"
          />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="value" className={labelCls}>
            Reading value ({KIND_UNIT[kind]})
          </label>
          <input
            id="value"
            type="number"
            step="0.01"
            min="0"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={field}
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground">
            {lastReading
              ? `Last reading: ${lastReading.value} ${KIND_UNIT[kind]} on ${new Date(lastReading.readingDate).toLocaleDateString()}`
              : "No previous reading yet — this will be the baseline."}
          </p>
          {diff != null && isReset && (
            <p className="text-xs text-muted-foreground">
              Recording as a new baseline — no consumption computed against the last reading.
            </p>
          )}
          {diff != null && !isReset && (
            <p className={diff < 0 ? "text-xs text-destructive" : "text-xs text-primary"}>
              {diff < 0
                ? `⚠ ${diff} ${KIND_UNIT[kind]} — below the last reading`
                : `+${diff} ${KIND_UNIT[kind]} since last reading`}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="date" className={labelCls}>
            Reading date
          </label>
          <input
            id="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={field}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isReset}
          onChange={(e) => setIsReset(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        This is a meter reset (meter replaced or rolled over)
      </label>

      <div className="space-y-1.5">
        <label htmlFor="note" className={labelCls}>
          Note (optional)
        </label>
        <input
          id="note"
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={field}
          placeholder="e.g. meter box behind the gate"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending || uploading || unitId === ""}>
        {pending ? "Recording…" : "Record reading"}
      </Button>
    </form>
  );
}

function ReadingRow({ row, onChanged }: { row: MeterReadingRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(String(row.value));
  const [date, setDate] = useState(row.readingDate.slice(0, 10));
  const [isReset, setIsReset] = useState(row.isReset);
  const [note, setNote] = useState(row.note ?? "");
  const [photoUrl, setPhotoUrl] = useState<string | null>(row.photoUrl);

  function startEdit() {
    setValue(String(row.value));
    setDate(row.readingDate.slice(0, 10));
    setIsReset(row.isReset);
    setNote(row.note ?? "");
    setPhotoUrl(row.photoUrl);
    setError(null);
    setEditing(true);
  }

  async function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("unitId", row.unitId);
    const res = await fetch("/api/meter-readings/upload", { method: "POST", body: form });
    const json = await res.json();
    setUploading(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to upload photo");
      return;
    }
    setPhotoUrl(json.data.url);
  }

  async function onSave() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/meter-readings/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: Number(value),
        readingDate: isoFromDate(date),
        isReset,
        note: note.trim() === "" ? null : note.trim(),
        photoUrl,
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to save changes");
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function onDelete() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/meter-readings/${row.id}`, { method: "DELETE" });
    const json = await res.json();
    setPending(false);
    if (!json.success) {
      setError(json.error?.message ?? "Failed to delete");
      return;
    }
    onChanged();
  }

  if (editing) {
    return (
      <tr className="border-b bg-muted/30 last:border-0">
        <td colSpan={7} className="px-4 py-4">
          <p className="mb-3 text-sm font-medium">
            Editing {row.propertyName} · {row.unitLabel} — {KIND_LABEL[row.kind]}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className={labelCls}>Value ({KIND_UNIT[row.kind]})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className={field}
              />
            </div>
            <div className="space-y-1.5">
              <label className={labelCls}>Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={field}
              />
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isReset}
              onChange={(e) => setIsReset(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            This is a meter reset (meter replaced or rolled over)
          </label>

          <div className="mt-3 space-y-1.5">
            <label className={labelCls}>Note</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={field}
              placeholder="e.g. meter box behind the gate"
            />
          </div>

          <div className="mt-3 space-y-1.5">
            <label className={labelCls}>Photo</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onPhotoSelected}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : photoUrl ? "Replace photo" : "Upload photo"}
              </Button>
              {photoUrl && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhotoUrl(null)}>
                  Remove photo
                </Button>
              )}
            </div>
            {photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoUrl}
                alt="Meter reading"
                className="mt-2 h-20 w-20 rounded-md border object-cover"
              />
            )}
          </div>

          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" onClick={onSave} disabled={pending || uploading}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3">
        {row.photoUrl ? (
          <a href={row.photoUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={row.photoUrl} alt="" className="h-10 w-10 rounded object-cover" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {row.propertyName} · {row.unitLabel}
      </td>
      <td className="px-4 py-3">{KIND_LABEL[row.kind]}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {new Date(row.readingDate).toLocaleDateString()}
      </td>
      <td className="px-4 py-3">
        {row.value} {KIND_UNIT[row.kind]}
      </td>
      <td className="px-4 py-3 text-muted-foreground">
        {row.consumption != null ? (
          `+${row.consumption} ${KIND_UNIT[row.kind]}`
        ) : row.isReset ? (
          <span className="inline-flex rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
            Reset
          </span>
        ) : (
          "— (baseline)"
        )}
      </td>
      <td className="px-4 py-3">
        {row.billed ? (
          <span className="text-xs text-muted-foreground">Billed</span>
        ) : (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={startEdit}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDelete} disabled={pending}>
              {pending ? "…" : "Delete"}
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </td>
    </tr>
  );
}

export function MeterReadingsManager({
  units,
  initialRows,
}: {
  units: UnitOption[];
  initialRows: MeterReadingRow[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <RecordForm units={units} rows={initialRows} onCreated={() => router.refresh()} />

      {initialRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No readings recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Photo</th>
              <th className="px-4 py-3 font-medium">Unit</th>
              <th className="px-4 py-3 font-medium">Utility</th>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 font-medium">Value</th>
              <th className="px-4 py-3 font-medium">Consumption</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {initialRows.map((row) => (
              <ReadingRow key={row.id} row={row} onChanged={() => router.refresh()} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
