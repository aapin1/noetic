// Which bottom-tab a `tab` step points at. `index` matches the tab-bar column
// order (atlas=0, archive=1, …) and `seg` matches the last route segment used
// to detect the user actually landed on that tab.
export type TutorialTabSeg = 'memory' | 'pulse' | 'trends' | 'mind' | 'profile';

export type TutorialTarget =
  // A measured on-screen region (the + FAB, the capture form). The region
  // reports its rect via useTutorialTarget; the step advances when its
  // relevant control is pressed.
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

// Tab steps come in prompt/info pairs: the prompt only ever asks the user to
// open the real tab (advances on navigation), and the matching info card only
// appears once they've actually landed there — never explain a screen before
// the user has seen it.
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'welcome',
    body: "a real walkthrough — you'll save one actual entry as you go. mneme turns what you read, watch, and think about into a connected map of your mind, built entirely from what you commit.",
    target: { kind: 'card' },
  },
  {
    id: 'capture',
    title: 'capture',
    body: 'tap + whenever you want to save something — a link, a note, a quote, or a photo. we\'ve queued up a real example link so you can see the whole flow.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureFab },
  },
  {
    id: 'capture-next',
    title: 'the source',
    body: "that's the link, ready to go. tap next and mneme fetches the actual page — title, text, everything — so it understands what's in it before asking your take.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureNext },
  },
  {
    id: 'capture-commit',
    title: 'react',
    body: 'committing is what puts this on your map — mneme reads what you saved, places it near related ideas, and starts building the connections behind your insights and history. a reaction is optional.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureCommit },
  },
  {
    id: 'atlas',
    title: 'atlas',
    body: "that's your first node, placed by what it's about — this is the map. tap any node to reopen or delete it, and as you save more, lines will form between ideas that relate.",
    target: { kind: 'card' },
  },
  {
    id: 'share',
    title: 'share to mneme',
    body: "you don't need to open mneme to save something. from any app, hit share and pick mneme — it drops straight into this same capture flow.",
    target: { kind: 'card' },
  },
  {
    id: 'archive-prompt',
    title: 'archive',
    body: "archive holds everything you've ever saved, in order. tap archive to open it.",
    target: { kind: 'tab', index: 1, seg: 'memory' },
  },
  {
    id: 'archive-info',
    title: 'archive',
    body: "this is every entry you've committed, newest first. scroll back through anything you've saved, any time — nothing here disappears.",
    target: { kind: 'card' },
  },
  {
    id: 'pulse-prompt',
    title: 'pulse',
    body: 'pulse is where you follow other people and see their maps. tap pulse to open it.',
    target: { kind: 'tab', index: 2, seg: 'pulse' },
  },
  {
    id: 'pulse-info',
    title: 'pulse',
    body: "follow anyone by their handle and see what they're saving and how their map connects — a window into someone else's mind, built the same way as yours.",
    target: { kind: 'card' },
  },
  {
    id: 'drift-prompt',
    title: 'drift',
    body: 'drift shows how your attention has moved over time. tap drift to open it.',
    target: { kind: 'tab', index: 3, seg: 'trends' },
  },
  {
    id: 'drift-info',
    title: 'drift',
    body: "this tracks the topics you keep returning to, and the ones you've drifted away from — a timeline of where your focus has actually gone.",
    target: { kind: 'card' },
  },
  {
    id: 'mind-prompt',
    title: 'mind',
    body: "mind surfaces patterns across everything you've saved. tap mind to open it.",
    target: { kind: 'tab', index: 4, seg: 'mind' },
  },
  {
    id: 'mind-info',
    title: 'mind',
    body: "this is where mneme connects the dots — recurring themes, tensions between ideas, and insights it noticed across everything on your map.",
    target: { kind: 'card' },
  },
  {
    id: 'you-prompt',
    title: 'you',
    body: 'you is your profile and account settings. tap you to open it.',
    target: { kind: 'tab', index: 5, seg: 'profile' },
  },
  {
    id: 'you-info',
    title: 'you',
    body: 'your profile, account, and preferences live here. want to see this walkthrough again? the ⓣ icon on the atlas screen starts it over any time.',
    target: { kind: 'card' },
  },
  {
    id: 'done',
    title: "you're set",
    body: "that's the map. go save something real — mneme gets more useful the more it has to work with.",
    target: { kind: 'card' },
  },
];
