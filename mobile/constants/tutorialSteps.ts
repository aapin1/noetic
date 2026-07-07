// Which bottom-tab a `tab` step points at. `index` matches the tab-bar column
// order (atlas=0, archive=1, …) and `seg` matches the last route segment used
// to detect the user actually landed on that tab.
export type TutorialTabSeg = 'memory' | 'pulse' | 'trends' | 'mind' | 'profile';

export type TutorialTarget =
  // A measured on-screen control (the + FAB, the capture buttons). The control
  // reports its rect via useTutorialTarget; the step advances when it's pressed.
  | { kind: 'registered'; id: string }
  // A bottom-tab, spotlit geometrically (equal columns). Advances when the
  // route changes to `seg` — i.e. the user tapped the real tab.
  | { kind: 'tab'; index: number; seg: TutorialTabSeg }
  // No target: an informational card the user dismisses with a button.
  | { kind: 'card' };

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  target: TutorialTarget;
  // Dim opacity for card steps (0–1). Lower = more of the screen shows through,
  // used on the atlas step so the freshly-saved node stays visible.
  scrim?: number;
}

// Registered-target ids, shared between the steps, the context, and the
// instrumented controls so there's a single source of truth for the strings.
export const TUTORIAL_TARGET = {
  captureFab: 'capture-fab',
  captureNext: 'capture-next',
  captureCommit: 'capture-commit',
} as const;

// A stable, richly-scrapeable article used for the guided first capture. If the
// site is unreachable the capture still succeeds (the flow just falls back to
// the "what was it about?" prompt), so the tutorial never hard-fails on it.
export const TUTORIAL_EXAMPLE_LINK = 'https://www.paulgraham.com/greatwork.html';

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'welcome',
    body: "A quick tour. You'll log your first node as you go.",
    target: { kind: 'card' },
  },
  {
    id: 'capture',
    title: 'capture',
    body: "Tap + to save something. We've dropped in an example link.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureFab },
  },
  {
    id: 'capture-next',
    title: 'the source',
    body: 'That’s your link. Tap next — mneme reads the whole piece.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureNext },
  },
  {
    id: 'capture-commit',
    title: 'react',
    body: 'Add a line, or leave it blank. Tap commit to save.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureCommit },
  },
  {
    id: 'atlas',
    title: 'atlas',
    body: 'Your first node. Tap it anytime to open or delete it. Lines form as ideas connect.',
    target: { kind: 'card' },
    scrim: 0.25,
  },
  {
    id: 'share',
    title: 'share to mneme',
    body: 'From any app, hit share and pick mneme. It lands in this same flow.',
    target: { kind: 'card' },
  },
  {
    id: 'archive',
    title: 'archive',
    body: 'Everything you save, in order. Tap archive.',
    target: { kind: 'tab', index: 1, seg: 'memory' },
  },
  {
    id: 'pulse',
    title: 'pulse',
    body: 'Follow people by handle and see their maps. Tap pulse.',
    target: { kind: 'tab', index: 2, seg: 'pulse' },
  },
  {
    id: 'drift',
    title: 'drift',
    body: 'How your attention moves over time. Tap drift.',
    target: { kind: 'tab', index: 3, seg: 'trends' },
  },
  {
    id: 'mind',
    title: 'mind',
    body: "Patterns and tensions across what you've saved. Tap mind.",
    target: { kind: 'tab', index: 4, seg: 'mind' },
  },
  {
    id: 'you',
    title: 'you',
    body: 'Your profile and settings. Tap you.',
    target: { kind: 'tab', index: 5, seg: 'profile' },
  },
  {
    id: 'done',
    title: "you're set",
    body: "That's the map. Go save something real.",
    target: { kind: 'card' },
  },
];
