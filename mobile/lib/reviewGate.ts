/**
 * The pure gate for the App Store rating prompt. Kept free of imports so it
 * can be unit-tested under the backend's node test runner — everything
 * environmental (storage, clocks, the StoreReview module) lives in review.ts.
 */
export type ReviewStats = {
  captureCount: number;
  sessionCount: number;
  /** Fractional days since signup; null when the signup date is unknown. */
  accountAgeDays: number | null;
  tutorialActive: boolean;
  /** App version we last prompted on; null if never prompted. */
  promptedVersion: string | null;
  currentVersion: string;
};

export function shouldRequestReview(stats: ReviewStats): boolean {
  if (stats.tutorialActive) return false;
  if (stats.captureCount < 5) return false;
  if (stats.sessionCount < 3) return false;
  if (stats.accountAgeDays === null || stats.accountAgeDays < 3) return false;
  if (stats.promptedVersion === stats.currentVersion) return false;
  return true;
}
