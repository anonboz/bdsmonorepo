"use client";

// Inline status control: a native <select> that PATCHes `{ status }` to the
// given endpoint and refreshes the server-rendered page. Options are the
// transitions the caller allows from the current status; the current value is
// always listed first so the control reads correctly before any change.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@repo/ui";

export type StatusOption = { value: string; label: string };

export function StatusSelect({
  endpoint,
  current,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  endpoint: string;
  current: string;
  options: readonly StatusOption[];
  className?: string;
  "aria-label": string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const select = e.target;
    const status = select.value;
    if (status === current) return;
    setPending(true);
    setError(null);
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setPending(false);
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(json?.error?.message ?? "Update failed");
      select.value = current;
      return;
    }
    router.refresh();
  }

  if (options.length === 0) return null;

  return (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <select
        aria-label={ariaLabel}
        defaultValue={current}
        onChange={onChange}
        disabled={pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <option value={current} disabled>
          Change status…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
