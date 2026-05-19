/** Date helpers — promote to a shared web-kit once a third app needs them. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const day = iso.length > 10 ? iso.slice(0, 10) : iso;
  return new Date(day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
