/**
 * Backend stores naive UTC datetimes and emits ISO strings without a timezone
 * suffix. JavaScript's `new Date(iso)` interprets a suffix-less ISO string as
 * local time, which mis-shifts every displayed timestamp by the user's offset.
 *
 * `parseServerDate` forces UTC interpretation when the string carries no
 * timezone indicator. `formatDateTime` / `formatDate` then render in the
 * browser's local timezone via toLocaleString.
 */

export function parseServerDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // Already has tz info (Z or ±HH:MM at the end of the time component).
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
  return new Date(hasTz ? iso : iso + 'Z');
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = parseServerDate(iso);
  return d ? d.toLocaleString() : '—';
}

export function formatDate(iso: string | null | undefined): string {
  const d = parseServerDate(iso);
  return d ? d.toLocaleDateString() : '—';
}
