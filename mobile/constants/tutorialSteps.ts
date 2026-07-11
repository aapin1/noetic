// Which bottom-tab a `tab` step points at. `index` matches the tab-bar column
// order (atlas=0, archive=1, …) and `seg` matches the last route segment used
// to detect the user actually landed on that tab.
export type TutorialTabSeg = 'memory' | 'pulse' | 'mind' | 'profile';

// Total tab-bar columns — the overlay divides the screen width by this to
// spotlight a tab, so it MUST match the number of <Tabs.Screen> entries in
// app/(tabs)/_layout.tsx (atlas, archive, pulse, mind, you).
export const TAB_COUNT = 5;

export type TutorialTarget =
  // A measured on-screen region (the + FAB, the capture form, a node). The
  // region reports its rect via useTutorialTarget; the step advances when its
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
  // Which side of the screen the card is pinned to. Defaults to top when
  // there's a hole to stay clear of (bottom otherwise) — override when the
  // hole sits inside a full-screen surface that already has its own text
  // above it (the capture form), where a top-pinned card would cover it.
  cardSide?: 'top' | 'bottom';
  // Registered/tab steps normally only advance when the user touches the
  // real control. Set this when the target might never resolve (e.g. it
  // depends on something from an earlier step that could have failed) so the
  // card's own button is always there as a way to move on.
  dismissible?: boolean;
}

// Registered-target ids, shared between the steps, the context, and the
// instrumented controls so there's a single source of truth for the strings.
export const TUTORIAL_TARGET = {
  captureFab: 'capture-fab',
  captureNext: 'capture-next',
  captureCommit: 'capture-commit',
  nodeTap: 'node-tap',
  nodeDelete: 'node-delete',
  companionFab: 'companion-fab',
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
    cardSide: 'bottom',
  },
  {
    id: 'capture-commit',
    title: 'react',
    body: "committing saves this to your map — mneme reads it, places it near related ideas, and builds the connections behind your insights over time. a reaction is optional; commit whenever you're ready.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureCommit },
    cardSide: 'bottom',
  },
  {
    id: 'atlas',
    title: 'atlas',
    body: "that's your first node, placed by what it's about — this is the map. as you save more, lines will form between ideas that relate. next, a quick look at what you can do with a node.",
    target: { kind: 'card' },
  },
  {
    id: 'node-manage-prompt',
    title: 'manage nodes',
    body: "every node opens the same way. tap your new node to see it again.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeTap },
    dismissible: true,
  },
  {
    id: 'node-manage-info',
    title: 'node detail',
    body: "this is what opens for any node: its title, your reaction, and a link to its full insight — the AI-built writeup of how it connects to everything else.",
    target: { kind: 'card' },
  },
  {
    id: 'node-delete',
    title: 'delete',
    body: "you can remove anything you've saved. tap delete below, then confirm — this was just a demo entry, so clearing it keeps your real map accurate.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeDelete },
    dismissible: true,
    // The delete button sits inside the right-side drawer, which has its own
    // text above it — a top-pinned card would cover that, same issue as the
    // capture form.
    cardSide: 'bottom',
  },
  {
    id: 'share',
    title: 'share to mneme',
    body: "you don't need to open mneme to save something. from any app, hit share and pick mneme — it saves instantly, and you can peek at the insight right after.",
    target: { kind: 'card' },
  },
  {
    id: 'archive-prompt',
    title: 'archive',
    body: "archive holds everything you've ever saved. tap archive to open it.",
    target: { kind: 'tab', index: 1, seg: 'memory' },
  },
  {
    id: 'archive-info',
    title: 'archive',
    body: "everything you've committed, filed into folders by topic — and a search box that reaches across all of it. nothing here disappears.",
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
    id: 'mind-prompt',
    title: 'mind',
    body: "mind surfaces patterns across everything you've saved. tap mind to open it.",
    target: { kind: 'tab', index: 3, seg: 'mind' },
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
    target: { kind: 'tab', index: 4, seg: 'profile' },
  },
  {
    id: 'you-info',
    title: 'you',
    body: 'your profile, account, and preferences live here. want to see this walkthrough again? the ⓣ icon on the atlas screen starts it over any time.',
    target: { kind: 'card' },
  },
  {
    id: 'companion',
    title: 'companion',
    body: "one more thing: the floating chat icon is mneme's companion. tap it any time to talk through what you've saved — ask it questions, or let it ask you some.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.companionFab },
    dismissible: true,
  },
  {
    id: 'done',
    title: "you're set",
    body: "that's the map. go save something real — mneme gets more useful the more it has to work with.",
    target: { kind: 'card' },
  },
];
