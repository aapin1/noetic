// Progressive disclosure: whispers and tab pulses.
//
// A WHISPER is one lowercase line anchored to the thing it describes. It fires
// exactly once per install, at most MAX_WHISPERS_PER_SESSION per session, and
// never alongside another whisper — arbitration picks the highest-priority
// pending candidate only when nothing is showing.
//
// A TAB PULSE is a quiet glow on a tab icon that arms when the tab first has
// real content and disarms forever the first time the user visits the tab
// while it glows.
//
// This module is the pure core: no react, no react-native, no imports — it
// runs under the backend vitest target (`npm run test:unit` includes
// mobile/lib/**/*.test.ts). All persistence and rendering live in
// contexts/DisclosureContext.tsx.

/** Durable event flags share the seen-set with whispers and glows. */
export const EVENT_FLAGS = {
  sharedAtlas: "event:shared-atlas",
  linkCaptured: "event:link-captured",
  voiceStyleChosen: "event:voice-style-chosen",
  ritualDone: "event:ritual-done",
  promiseMade: "event:promise-made",
} as const;

// Lower number = more important. Whispers about what the user is touching
// right now outrank ambient feature introductions.
export const WHISPERS = {
  // "you've got a link copied — put it on the map?"
  "clipboard-link": { priority: 10 },
  // "mneme noticed something →" (first real edge, points at Mind)
  "mind-first-edge": { priority: 20 },
  // "next time, save from anywhere" (after first in-app LINK capture)
  "share-extension": { priority: 30 },
  // "minds you know" (Pulse introduced from strength, after share-your-atlas)
  "pulse-intro": { priority: 40 },
  // "you're @n_1a2b — make it yours?" (first touch of Pulse or share)
  "identity-claim": { priority: 50 },
} as const;

export type WhisperId = keyof typeof WHISPERS;

export const MAX_WHISPERS_PER_SESSION = 2;

export function isWhisperId(id: string): id is WhisperId {
  return id in WHISPERS;
}

/**
 * Pick the whisper to show next, or null. Callers only invoke this when no
 * whisper is currently visible — a showing whisper is never replaced, so two
 * can never stack.
 */
export function pickNextWhisper(
  pending: readonly WhisperId[],
  seen: ReadonlySet<string>,
  shownThisSession: number,
): WhisperId | null {
  if (shownThisSession >= MAX_WHISPERS_PER_SESSION) {
    return null;
  }

  let best: WhisperId | null = null;
  for (const id of pending) {
    if (!isWhisperId(id) || seen.has(id)) {
      continue;
    }
    if (best === null || WHISPERS[id].priority < WHISPERS[best].priority) {
      best = id;
    }
  }
  return best;
}

/**
 * Handles minted by the server's anonymous fallback (`n_` + 4 random bytes as
 * hex). The identity-claim whisper only speaks to users still carrying one —
 * a chosen handle is already theirs.
 */
export function isAnonymousHandle(handle: string | null | undefined): boolean {
  return typeof handle === "string" && /^n_[0-9a-f]{8}$/.test(handle);
}

export type TabGlowKey = "mind" | "archive" | "you" | "pulse";

/** The seen-flag that permanently retires a glow once its tab is visited. */
export function glowSeenFlag(tab: TabGlowKey): string {
  return `glow:${tab}`;
}

export type RevealSignals = {
  /** Total real captures (server count, never includes ghost/demo nodes). */
  captureCount: number;
  /** At least one edge exists between the user's own captures. */
  hasOwnEdge: boolean;
};

export const ARCHIVE_REVEAL_COUNT = 5;
export const YOU_REVEAL_COUNT = 10;

/**
 * Edge-triggered reveal schedule. A glow shows while its condition holds and
 * the user has not yet visited the tab under glow (the seen-flag). Conditions
 * only ever become true — captures accumulate, edges persist — so there is no
 * flicker to debounce.
 *
 * Pulse is deliberately absent from the signal object: it reveals from
 * strength, keyed off the durable shared-atlas event flag, never off counts.
 */
export function computeTabGlows(
  signals: RevealSignals,
  seen: ReadonlySet<string>,
): Record<TabGlowKey, boolean> {
  return {
    mind: signals.hasOwnEdge && !seen.has(glowSeenFlag("mind")),
    archive: signals.captureCount >= ARCHIVE_REVEAL_COUNT && !seen.has(glowSeenFlag("archive")),
    you: signals.captureCount >= YOU_REVEAL_COUNT && !seen.has(glowSeenFlag("you")),
    pulse: seen.has(EVENT_FLAGS.sharedAtlas) && !seen.has(glowSeenFlag("pulse")),
  };
}
