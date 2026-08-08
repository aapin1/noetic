import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';
import { shouldRequestReview } from '@/lib/reviewGate';

/**
 * Asking for a rating is a withdrawal from goodwill, so it happens at most
 * once per app version, and only for someone demonstrably getting value:
 * five captures, three sessions, an account at least three days old, never
 * mid-tutorial. Everything here is fire-and-forget — a failure to count or
 * to prompt must never surface in the capture flow it rides on.
 */
const CAPTURE_COUNT_KEY = 'mneme_review_capture_count';
const SESSION_COUNT_KEY = 'mneme_review_session_count';
const PROMPTED_VERSION_KEY = 'mneme_review_prompted_version';

async function readCount(key: string): Promise<number> {
  const raw = await AsyncStorage.getItem(key);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

async function increment(key: string): Promise<void> {
  try {
    const current = await readCount(key);
    await AsyncStorage.setItem(key, String(current + 1));
  } catch {
    // Counting is best-effort; a missed increment only delays the prompt.
  }
}

/** Once per JS launch, next to trackSessionStart. */
export function noteSessionForReview(): void {
  void increment(SESSION_COUNT_KEY);
}

/** On a capture that actually succeeded — composer or share-sheet re-entry. */
export function noteCaptureForReview(): void {
  void increment(CAPTURE_COUNT_KEY);
}

export async function maybeRequestReview(args: {
  accountCreatedAt: string | null;
  tutorialActive: boolean;
}): Promise<void> {
  try {
    const currentVersion = Constants.expoConfig?.version ?? '1.0.0';
    const [captureCount, sessionCount, promptedVersion] = await Promise.all([
      readCount(CAPTURE_COUNT_KEY),
      readCount(SESSION_COUNT_KEY),
      AsyncStorage.getItem(PROMPTED_VERSION_KEY),
    ]);
    const signupMs = args.accountCreatedAt ? Date.parse(args.accountCreatedAt) : NaN;
    const accountAgeDays = Number.isFinite(signupMs)
      ? (Date.now() - signupMs) / 86_400_000
      : null;

    const ok = shouldRequestReview({
      captureCount,
      sessionCount,
      accountAgeDays,
      tutorialActive: args.tutorialActive,
      promptedVersion,
      currentVersion,
    });
    if (!ok) return;

    // Mark before asking: iOS may silently decline to show the card, and a
    // re-ask on the same version is exactly what the gate exists to prevent.
    await AsyncStorage.setItem(PROMPTED_VERSION_KEY, currentVersion);
    if (await StoreReview.isAvailableAsync()) {
      await StoreReview.requestReview();
    }
  } catch {
    // Never a visible failure — the user did nothing that should error.
  }
}
