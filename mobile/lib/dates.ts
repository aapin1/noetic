/**
 * Date labels the way iOS apps print them.
 *
 *   dayLabel        "Today", "Yesterday", "Monday" inside the last week, then
 *                   "October 2", with the year once it is not this year.
 *   shortDate       "Oct 2" for a row's trailing date; "Oct 2, 2025" out of year.
 *   relativeDate    "2m ago", "3h ago", then falls back to shortDate.
 */

const WEEK_MS = 6 * 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayLabel(input: string | number | Date, now: Date = new Date()): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays > 1 && diffDays * 24 * 60 * 60 * 1000 <= WEEK_MS) {
    return d.toLocaleDateString(undefined, { weekday: 'long' });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function shortDate(input: string | number | Date, now: Date = new Date()): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function relativeDate(input: string | number | Date, now: Date = new Date()): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const label = dayLabel(d, now);
  return label === 'Today' || label === 'Yesterday' ? label : shortDate(d, now);
}
