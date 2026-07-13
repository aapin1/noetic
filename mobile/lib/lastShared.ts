import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'mneme:lastSharedCapture';

/** Shares older than this don't resurface — a pill for last week's capture
 * would read as a glitch, not a continuation of the share. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remembers the capture just saved from the OS share sheet so the map can
 * offer its insight on the next app open — sharing usually ends outside the
 * app, before the insight is ever seen. Share-intent captures only; in-app
 * captures already surface the insight (or the saved pill) immediately.
 */
export async function rememberSharedCapture(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // best-effort — losing the reminder never blocks the capture itself
  }
}

/** Clears the reminder once the insight has been opened from the share screen. */
export async function clearSharedCapture(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Read-and-clear: returns the recently shared capture id (if any, and fresh
 * enough), removing the marker so the pill shows exactly once.
 */
export async function takeRecentSharedCapture(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof parsed.id !== 'string' || typeof parsed.at !== 'number') return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) return null;
    return parsed.id;
  } catch {
    return null;
  }
}
