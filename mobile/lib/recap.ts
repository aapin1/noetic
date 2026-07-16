import { Alert } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import type { CaptureSummary } from '@/types/api';

/** Cap so a slideshow stays watchable and capture stays fast. */
export const RECAP_MAX = 10;

/** Aspect ratio of a share frame — 4:5 portrait, friendly to stories/TikTok. */
export const RECAP_ASPECT = 1.25;

/** Tap-to-fill cover titles; the field stays editable after picking one. */
export const RECAP_TITLE_PRESETS = [
  "What I've been up to",
  'Media I loved this week',
  "What I've been reading",
  'Lately on my mind',
  'From my memory',
] as const;

export type RecapWindow = 'all' | 'week' | 'month';

export const RECAP_WINDOWS: { key: RecapWindow; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

const DAY = 86_400_000;

export function withinWindow(iso: string, window: RecapWindow, now = Date.now()): boolean {
  if (window === 'all') return true;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const span = window === 'week' ? 7 * DAY : 30 * DAY;
  return now - t <= span;
}

export interface RecapFilters {
  window: RecapWindow;
  topicId: string | null;
  query: string;
}

/** Filter the loaded (most-recent-first) captures by window, topic, and search. */
export function applyRecapFilters(
  items: CaptureSummary[],
  f: RecapFilters,
  now = Date.now(),
): CaptureSummary[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((it) => {
    if (!withinWindow(it.capturedAt, f.window, now)) return false;
    if (f.topicId && !it.topics.some((t) => t.topicId === f.topicId)) return false;
    if (q) {
      const hay = [it.title, it.contentItem?.sourceName, it.contentItem?.authorName, it.keyIdea, it.summary]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Distinct topics across the loaded set, most-used first — feeds the filter chips. */
export function topicOptions(items: CaptureSummary[]): { topicId: string; name: string; count: number }[] {
  const map = new Map<string, { topicId: string; name: string; count: number }>();
  for (const it of items) {
    for (const t of it.topics) {
      const cur = map.get(t.topicId);
      if (cur) cur.count += 1;
      else map.set(t.topicId, { topicId: t.topicId, name: t.name, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** "Mar 3 – Mar 9" (or a single date) spanning the selected captures. */
export function dateRangeLabel(items: CaptureSummary[]): string {
  const times = items
    .map((i) => new Date(i.capturedAt).getTime())
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (times.length === 0) return '';
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const first = fmt(times[0]);
  const last = fmt(times[times.length - 1]);
  return first === last ? last : `${first} – ${last}`;
}

/** The primary topic to stamp on a node card — prefer a specific label over a field. */
export function primaryTopic(item: CaptureSummary): string | null {
  const specific = item.topics.find((t) => t.kind === 'specific');
  return (specific ?? item.topics[0])?.name ?? null;
}

/** The remote image a node card should show, if any. */
export function nodeImage(item: CaptureSummary): string | null {
  return (item.kind === 'IMAGE' ? item.mediaUrl : item.contentItem?.imageUrl) ?? null;
}

/** The line of thought a node card leads with. */
export function nodeIdea(item: CaptureSummary): string | null {
  return item.keyIdea ?? item.summary ?? item.contentItem?.description ?? null;
}

/* --------------------------------------------------------------- capture io --- */

// captureRef accepts a ref to any host view; typed loosely to avoid leaking the
// library's internal ref shape through every call site.
type CaptureRef = Parameters<typeof captureRef>[0];

export async function captureFrame(ref: CaptureRef): Promise<string> {
  return captureRef(ref, { format: 'png', quality: 1, result: 'tmpfile' });
}

export async function shareImage(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    Alert.alert('Sharing unavailable', 'This device can’t open the share sheet.');
    return;
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle: 'Share your recap',
  });
}

/** Save every frame to the camera roll so the user can build a slideshow post. */
export async function saveFramesToPhotos(uris: string[]): Promise<boolean> {
  // writeOnly ("add photos") — saving a card only needs add access, and asking
  // for full-library access is more likely to be denied/limited.
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    Alert.alert('Photos access needed', 'Allow Photos access in Settings to save your cards.');
    return false;
  }
  for (const uri of uris) {
    await MediaLibrary.saveToLibraryAsync(uri);
  }
  return true;
}
