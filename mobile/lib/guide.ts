// The onboarding guide: comprehensive like the old 23-step tour, invasive
// like nothing. One small pill at a time (the same glass pill captures use),
// each carrying ONE short line and at most one action. Steps complete
// themselves when the user actually does the thing — organically or via the
// pill — and ✕ always just moves on. By the end the user has met capture,
// the node/insight, connections, mind, archive, the share extension, import,
// and the companion; pulse and you are named in the finale and reveal
// themselves through the tab-pulse ladder.
//
// Pure module, no imports — testable under the backend vitest target. All
// persistence (ack flags, visited flags) and rendering live in the map
// screen and DisclosureContext.

export type GuideSignals = {
  /** Real captures on the server — never demo/ghost content. */
  captureCount: number;
  /** Opened a node's drawer at least once. */
  openedNode: boolean;
  visitedMind: boolean;
  visitedArchive: boolean;
  visitedImport: boolean;
  openedCompanion: boolean;
};

export type GuideStepId =
  | "first-capture"
  | "open-node"
  | "second-thought"
  | "mind"
  | "archive"
  | "share-anywhere"
  | "import"
  | "companion"
  | "finale";

export type GuideStep = {
  id: GuideStepId;
  /** The pill's one line. If it doesn't fit in a pill, it doesn't ship. */
  line: string;
  /**
   * Action label. 'action' steps complete via their signal (the cta just
   * takes you there); 'ack' steps have nothing to detect — the cta or ✕
   * acknowledges them.
   */
  cta: string | null;
  kind: "action" | "ack";
  done: (s: GuideSignals) => boolean;
};

const never = () => false;

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: "first-capture",
    line: "need a hand with your first capture?",
    cta: "yes →",
    kind: "action",
    done: (s) => s.captureCount >= 1,
  },
  {
    id: "open-node",
    line: "tap your new node — mneme read it",
    cta: null,
    kind: "action",
    done: (s) => s.openedNode,
  },
  {
    id: "second-thought",
    line: "add another — watch them connect",
    cta: "capture →",
    kind: "action",
    done: (s) => s.captureCount >= 2,
  },
  {
    id: "mind",
    line: "patterns surface in mind",
    cta: "open mind →",
    kind: "action",
    done: (s) => s.visitedMind,
  },
  {
    id: "archive",
    line: "it all files itself in archive",
    cta: "open archive →",
    kind: "action",
    done: (s) => s.visitedArchive,
  },
  {
    id: "share-anywhere",
    line: "save from anywhere: share → mneme",
    cta: "got it",
    kind: "ack",
    done: never,
  },
  {
    id: "import",
    line: "years of saves? make them a map",
    cta: "import →",
    kind: "action",
    done: (s) => s.visitedImport,
  },
  {
    id: "companion",
    line: "stuck on an idea? companion thinks with you",
    cta: "got it",
    kind: "ack",
    done: never,
  },
  {
    id: "finale",
    line: "that's the loop — save, and it comes back",
    cta: "done",
    kind: "ack",
    done: never,
  },
];

/** Persisted when a step is acknowledged/skipped — it never returns. */
export function guideAckFlag(id: GuideStepId): string {
  return `guide:ack:${id}`;
}

/** Durable flags the guide's signals are read from (disclosure seen-set). */
export const GUIDE_SIGNAL_FLAGS = {
  openedNode: "event:opened-node",
  visitedImport: "event:visited-import",
  openedCompanion: "event:opened-companion",
} as const;

/** Every tab focus records one of these, once — the guide reads them. */
export function visitedTabFlag(tab: string): string {
  return `visited:${tab}`;
}

export const GUIDE_DONE_FLAG = "guide:done";

/** An account below this is new enough for the guide to introduce itself. */
export const GUIDE_MAX_CORPUS = 5;

/**
 * The next step worth showing, or null when the guide has nothing left to
 * say. Order is fixed; a step is passed over once its signal is true or the
 * user waved it off.
 */
export function nextGuideStep(
  signals: GuideSignals,
  hasSeen: (flag: string) => boolean,
): GuideStep | null {
  for (const step of GUIDE_STEPS) {
    if (step.done(signals)) continue;
    if (hasSeen(guideAckFlag(step.id))) continue;
    return step;
  }
  return null;
}
