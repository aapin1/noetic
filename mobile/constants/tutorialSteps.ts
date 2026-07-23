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
// a real capture of the example link would produce, lives purely in component
// state, and is removed by the delete step (or when the walkthrough ends).
export const TUTORIAL_DEMO_NODE = {
  id: 'tutorial-demo-node',
  label: 'How to Do Great Work',
  keyIdea: 'pick work that matches your curiosity, aim at the frontier, and notice the gaps others overlook.',
} as const;

// Tab steps come in prompt/info pairs: the prompt only ever asks the user to
// open the real tab (advances on navigation), and the matching info card only
// appears once they've actually landed there — never explain a screen before
// the user has seen it.
//
// Ordering rule: a step that spotlights a control may only appear while the
// screen owning that control is on screen. The atlas header/toolbar steps
// (lenses, recenter, discover, companion) therefore all sit in atlas sections,
// and `companion` is deliberately the LAST interactive step of the whole tour
// — tapping it navigates off the tab bar, so anything requiring the tab bar
// has to have happened already.
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'welcome to mneme',
    body: 'mneme turns what you read, watch, and think into a living map of your mind. this walkthrough saves one practice entry — it takes about a minute.',
    target: { kind: 'card' },
  },
  {
    id: 'capture',
    title: 'capture',
    body: "the + takes anything: articles, blog posts, youtube videos, tweets, stray thoughts, photos. we've loaded an example link for you — tap the +.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureFab },
  },
  {
    id: 'capture-next',
    title: 'the source',
    body: 'your link is queued. mneme reads the page itself, so you never have to summarize what you save. tap next.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureNext },
  },
  {
    id: 'capture-commit',
    title: 'make it yours',
    body: "add a one-line reaction if something struck you — optional, just for you. real captures can go straight to save in one tap; here, hit commit to place it on your map.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.captureCommit },
  },
  {
    id: 'atlas',
    title: 'your first node',
    body: 'there it lands. every node is placed by meaning, so related ideas sit close — and as you save more, lines form between them.',
    target: { kind: 'card' },
  },
  {
    id: 'node-manage-prompt',
    title: 'open a node',
    body: "tap your new node to see what's inside.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeTap },
  },
  {
    id: 'node-manage-info',
    title: 'the detail panel',
    body: "here it is: the source, your reaction, and its topics. real captures also carry an insight — mneme's short take on how the idea fits your thinking.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodePanel },
    dismissible: true,
  },
  {
    id: 'node-delete',
    title: "you're in control",
    body: 'anything can be removed. this node was just practice — tap delete, then confirm.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.nodeDelete },
  },
  {
    id: 'lenses',
    title: 'two lenses',
    body: 'one map, two views: semantic groups ideas by meaning, time replays your thinking as it happened. tap either one.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasLenses },
  },
  {
    id: 'recenter',
    title: 'recenter',
    body: 'lost in the map? this snaps everything back into view. give it a tap.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasRecenter },
  },
  {
    id: 'multi-select',
    title: 'multi-select',
    body: 'the crosshair selects a few nodes — or the lines between them — so you can open them together and explore what connects them. the magnifier beside it searches the map. tap the crosshair.',
    target: { kind: 'registered', id: TUTORIAL_TARGET.atlasDiscover },
  },
  {
    id: 'share',
    title: 'the fast way in',
    body: "you'll mostly capture without opening mneme: from your browser, youtube, substack — anywhere — hit share and pick mneme. it's saved and mapped before you're back to reading.",
    target: { kind: 'card' },
    visual: 'share',
  },
  {
    id: 'mind-prompt',
    title: 'mind',
    body: 'mind is where patterns surface. tap mind.',
    target: { kind: 'tab', index: 1, seg: 'mind' },
  },
  {
    id: 'mind-info',
    title: 'mind',
    body: "mneme watches the whole map and hands back instruments: threads you're chasing, ideas in tension, sources converging, topics gone quiet. open one and it takes over the screen. it's quiet until you've saved a few things.",
    target: { kind: 'card' },
  },
  {
    id: 'archive-prompt',
    title: 'archive',
    body: 'the map is for seeing; archive is for finding. tap archive.',
    target: { kind: 'tab', index: 2, seg: 'memory' },
  },
  {
    id: 'archive-info',
    title: 'archive',
    body: "everything you've saved — as a diary day by day, or filed into topic folders — with search that digs through all of it. nothing is ever lost.",
    target: { kind: 'card' },
  },
  {
    id: 'pulse-prompt',
    title: 'pulse',
    body: "pulse is other people's maps. tap pulse.",
    target: { kind: 'tab', index: 3, seg: 'pulse' },
  },
  {
    id: 'pulse-info',
    title: 'pulse',
    body: "search a handle to follow someone, then watch their map fill in beside what they're saving — and see where their territory overlaps yours.",
    target: { kind: 'card' },
  },
  {
    id: 'you-prompt',
    title: 'you',
    body: 'your profile, your numbers, your settings — tap you.',
    target: { kind: 'tab', index: 4, seg: 'profile' },
  },
  {
    id: 'you-info',
    title: 'you',
    body: 'your handle is how people find you here. below it, mneme keeps a running read of what you saved and where you went deep — yours to scroll, and to share as a recap.',
    target: { kind: 'card' },
  },
  {
    id: 'atlas-return',
    title: 'back to the map',
    body: 'one last thing to show you. tap atlas.',
    target: { kind: 'tab', index: 0, seg: '(tabs)' },
  },
  {
    id: 'companion',
    title: 'companion',
    body: "the speech bubble in the toolbar is your companion — it moved up here so it's with the rest of the map's tools. tap it to say hello; you can talk through anything you've saved, any time.",
    target: { kind: 'registered', id: TUTORIAL_TARGET.companionFab },
  },
  {
    id: 'done',
    title: "that's mneme",
    body: 'save one real thing today — the map gets smarter with every node. replay this tour any time from the ⓣ on atlas.',
    target: { kind: 'card' },
  },
];
