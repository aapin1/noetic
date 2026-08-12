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
    {
      id: 'tutorial-demo-insight',
      type: 'NOVELTY' as const,
      headline: 'Curiosity as a compass',
      body:
        "This is what an insight looks like: mneme's read on how a capture fits what you've saved. The essay argues that curiosity is a better guide than ambition, because it points at problems you'll actually stay with. As your map grows, insights start connecting new saves to old ones.",
      strength: 0.8,
      evidence: null,
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
    title: 'welcome to mneme',
    body: 'log anything you find intellectually stimulating and mneme plots it on this map — spatially, the way your brain organizes concepts. this takes about a minute.',
    target: { kind: 'card' },
  },
  {
    id: 'capture',
    title: 'capture',
    body: 'the + saves articles, videos, tweets, thoughts, and photos. we loaded an example link for you.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureFab },
    hint: 'tap the +',
  },
  {
    id: 'capture-next',
    title: 'the source',
    body: 'mneme reads the page itself and understands it — an article, a video, a paper, anything you throw at it — so the tedious part of logging is never yours.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureNext },
    hint: 'tap next',
  },
  {
    id: 'capture-commit',
    title: 'make it yours',
    body: 'you can leave a reaction — agree, disagree, a one-line review — and it saves alongside the article. always optional.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureCommit },
    hint: 'tap commit',
  },
  {
    id: 'seven-seconds',
    title: 'under 7 seconds',
    body: 'mneme is reading the page right now. everything you log — articles, videos, podcasts — takes under 7 seconds, start to finish.',
    target: { kind: 'card' },
    autoAdvance: true,
  },
  {
    id: 'atlas',
    title: 'your first node',
    body: 'there it lands. as you log more, related ideas settle close together — and the connections, contradictions, and tensions between them surface as insights for you to review.',
    target: { kind: 'card' },
  },
  {
    id: 'node-manage-prompt',
    title: 'open a node',
    body: 'every node keeps everything mneme learned about that save.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeTap },
    hint: 'tap your new node',
  },
  {
    id: 'node-manage-info',
    title: 'the detail panel',
    body: 'here you see the source, the date you logged it, and the topics mneme filed it under. view insight opens the full read — what it says, and how it fits everything else you save.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodePanel },
    dismissible: true,
  },
  {
    id: 'node-delete',
    title: "you're in control",
    body: 'this node was practice — clear it and the map is yours.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeDelete },
    hint: 'tap delete, then confirm',
  },
  {
    id: 'lenses',
    title: 'two lenses',
    body: 'semantic groups ideas by meaning. time replays them in the order you saved them.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasLenses },
    hint: 'tap either one',
  },
  {
    id: 'recenter',
    title: 'recenter',
    body: 'lost? this snaps the map back into view.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasRecenter },
    hint: 'tap recenter',
  },
  {
    id: 'multi-select',
    title: 'multi-select',
    body: 'the crosshair selects several nodes at once, so mneme can show you what runs between them — a connection, a contradiction, an insight. the magnifier searches.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasDiscover },
    hint: 'tap the crosshair',
  },
  {
    id: 'share',
    title: 'the fast way in',
    body: "from an article in your browser, a youtube video, anything you want to log — hit share and scroll until you find mneme. it saves without pulling you out of what you're reading, and mneme handles the rest.",
    target: { kind: 'card' },
    visual: 'share',
  },
  {
    id: 'companion',
    title: 'companion',
    body: 'the speech bubble is a chat that knows everything you saved.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.companionFab },
    hint: 'tap the speech bubble',
  },
  {
    id: 'done',
    title: "that's mneme",
    body: "you're on your own now. go save something real today — and replay this tour any time from the ⓣ.",
    target: { kind: 'card' },
    deferUntilAtlas: true,
  },
];
