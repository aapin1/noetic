// Which bottom-tab a `tab` step points at. `index` matches the tab-bar column
// order and `seg` matches the last route segment used to detect the user
// actually landed on that tab. The atlas tab is the group's index route, so it
// reports the group segment '(tabs)' rather than a screen name.
export type TutorialTabSeg = '(tabs)' | 'mind' | 'memory' | 'pulse' | 'profile';

// Total tab-bar columns — the overlay divides the screen width by this to
// spotlight a tab, so it MUST match the number of <Tabs.Screen> entries in
// app/(tabs)/_layout.tsx, in their declared order:
//   0 atlas · 1 mind · 2 archive (memory) · 3 pulse · 4 you (profile)
// Every `tab` step's `index` below is that column number — keep them in sync
// with the layout, not with the order the walkthrough happens to visit them.
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
  // Registered steps normally advance only when the user touches the lit
  // control. Set this for a spotlight that has nothing to tap — it lights a
  // region purely so the user can read it — so the card's own button is the
  // way on. Without it such a step is a dead end.
  dismissible?: boolean;
  // Footer instruction naming the actual control ("tap the +"). Shown in
  // place of the generic "tap the highlighted spot", so the body never has
  // to repeat the instruction.
  hint?: string;
  // A card with no button: the flow it narrates advances it programmatically.
  // The guided commit holds its card up for exactly as long as the simulated
  // read runs.
  autoAdvance?: boolean;
  // Held invisible until the user is back on the atlas. Used for the farewell
  // card, which should greet the first return from the companion rather than
  // paper over the companion itself.
  deferUntilAtlas?: boolean;
  // An illustration rendered inside the card, above the body text.
  visual?: 'share';
}

// Registered-target ids, shared between the steps, the context, and the
// instrumented controls so there's a single source of truth for the strings.
export const TUTORIAL_TARGET = {
  captureFab: 'capture-fab',
  captureNext: 'capture-next',
  captureCommit: 'capture-commit',
  nodeTap: 'node-tap',
  // The detail panel's text body — lit (not tapped) so the user can actually
  // read what slid in from the right instead of squinting at it through dim.
  nodePanel: 'node-panel',
  nodeDelete: 'node-delete',
  atlasLenses: 'atlas-lenses',
  atlasRecenter: 'atlas-recenter',
  atlasDiscover: 'atlas-discover',
  companionFab: 'companion-fab',
} as const;

// The link shown pre-filled in the guided first capture. Display-only: the
// walkthrough's capture is fully simulated on-device (no scrape, no AI, no
// server write), so the flow is identical every time and can never fail.
export const TUTORIAL_EXAMPLE_LINK = 'https://www.paulgraham.com/greatwork.html';

// The local-only node the simulated capture drops on the map. It mirrors what
// a real capture of the example link would produce — topics included, so the
// detail panel shows the full anatomy — lives purely in component state, and
// is removed by the delete step (or when the walkthrough ends).
export const TUTORIAL_DEMO_NODE = {
  id: 'tutorial-demo-node',
  label: 'How to Do Great Work',
  keyIdea: 'pick work that matches your curiosity, aim at the frontier, and notice the gaps others overlook.',
  topics: [
    { topicId: 'tutorial-topic-craft', name: 'doing great work', kind: 'specific' },
    { topicId: 'tutorial-topic-curiosity', name: 'curiosity', kind: 'general' },
  ],
} as const;

// What "view insight →" opens for the practice node: a canned CaptureDetail
// shaped exactly like the server's, so the insight screen renders it without
// a fetch (and without a spinner that could never resolve).
export const TUTORIAL_DEMO_CAPTURE = {
  id: TUTORIAL_DEMO_NODE.id,
  title: TUTORIAL_DEMO_NODE.label,
  summary:
    'Great work comes from choosing a problem your curiosity keeps returning to, working at the edge of what is known, and taking the gaps and anomalies others walk past seriously.',
  keyIdea: TUTORIAL_DEMO_NODE.keyIdea,
  capturedAt: new Date().toISOString(),
  reaction: null,
  userContext: null,
  kind: 'LINK' as const,
  topics: TUTORIAL_DEMO_NODE.topics.map((t) => ({
    topicId: t.topicId,
    name: t.name,
    slug: t.topicId,
    weight: 1,
    kind: t.kind as 'general' | 'specific',
  })),
  contentItem: {
    id: 'tutorial-demo-content',
    title: TUTORIAL_DEMO_NODE.label,
    description: 'An essay on how to choose and do work that matters.',
    canonicalUrl: TUTORIAL_EXAMPLE_LINK,
    sourceName: 'paulgraham.com',
    contentType: 'article',
    imageUrl: null,
    authorName: 'Paul Graham',
  },
  rawText: null,
  caption: null,
  mediaUrl: null,
  insights: [
    // Shaped like the READING every real first capture gets: a line that
    // shows the content was understood, then one move made on it (here, the
    // cost) — so the walkthrough shows the actual first reward rather than a
    // description of how insights will work later.
    {
      id: 'tutorial-demo-insight',
      type: 'READING' as const,
      headline: 'Curiosity is a better guide to great work than ambition, because it points at problems you will actually stay with.',
      body:
        'Following it means years of work nobody asked for before anyone can tell whether it was worth it. advice that reads differently from someone whose bets already paid off.',
      strength: 1,
      evidence: { kicker: 'the cost' },
    },
  ],
  related: [],
} as const;

// The whole tour lives on the atlas: capture, the node, the map controls,
// share, and the companion. The other tabs are NOT toured — each explains
// itself with its own empty state the first time the user lands there.
//
// Ordering rule: a step that spotlights a control may only appear while the
// screen owning that control is on screen, and `companion` is deliberately
// the LAST interactive step — tapping it navigates off the atlas, so
// anything anchored there has to have happened already.
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Mneme',
    body: 'Save anything that catches your mind and Mneme plots it on this map, spatially, the way your brain organizes concepts.',
    target: { kind: 'card' },
  },
  {
    id: 'capture',
    title: 'Capture',
    body: 'The + button saves articles, videos, tweets, thoughts, and photos. We loaded an example link for you.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureFab },
    hint: 'Tap the + button',
  },
  {
    id: 'capture-next',
    title: 'The source',
    body: 'Mneme reads the page itself and understands it: an article, a video, a paper, anything you give it. The tedious part of saving is never yours.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureNext },
    hint: 'Tap Next',
  },
  {
    id: 'capture-commit',
    title: 'Make it yours',
    body: 'You can leave a reaction (agree, disagree, a one-line review) and it saves along with what you logged. Always optional.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureCommit },
    hint: 'Tap Save',
  },
  {
    id: 'seven-seconds',
    title: 'Under 7 seconds',
    body: 'Mneme is reading the page right now. Everything you save takes under 7 seconds, start to finish.',
    target: { kind: 'card' },
    autoAdvance: true,
  },
  {
    id: 'atlas',
    title: 'Your first node',
    body: 'There it lands. As you save more, related ideas settle close together, and the connections, contradictions, and tensions between them surface as insights for you to review.',
    target: { kind: 'card' },
  },
  {
    id: 'node-manage-prompt',
    title: 'Open a node',
    body: 'Every node keeps everything Mneme learned about that save.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeTap },
    hint: 'Tap your new node',
  },
  {
    id: 'node-manage-info',
    title: 'The detail panel',
    body: 'Here you see the source, the date you saved it, and the topics Mneme filed it under. View insight opens the full read: what it says, and how it fits everything else you save.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodePanel },
    dismissible: true,
  },
  {
    id: 'node-delete',
    title: "You're in control",
    body: 'This node was practice. Clear it and the map is yours.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeDelete },
    hint: 'Tap Delete, then confirm',
  },
  {
    id: 'recenter',
    title: 'Recenter',
    body: 'Lost? This snaps the map back into view.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasRecenter },
    hint: 'Tap Recenter',
  },
  {
    id: 'share',
    title: 'The fast way in',
    body: "From an article in your browser, a YouTube video, anything you want to save: tap Share and scroll until you find Mneme. It saves without pulling you out of what you're reading, and Mneme handles the rest.",
    target: { kind: 'card' },
    visual: 'share',
  },
  {
    id: 'companion',
    title: 'Companion',
    body: 'The speech bubble is a chat that knows everything you saved.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.companionFab },
    hint: 'Tap the speech bubble',
  },
  {
    id: 'done',
    title: "That's Mneme",
    body: "You're on your own now. Replay this tour any time from the help button. The map grows from whatever catches you next.",
    target: { kind: 'card' },
    deferUntilAtlas: true,
  },
];
