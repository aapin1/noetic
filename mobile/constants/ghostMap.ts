import type { MemoryGraphResponse } from '@/types/api';

/**
 * The ghost map: a fully-formed demo constellation a brand-new user arrives
 * to, so the first thing they see is the destination — a mind, mapped — not
 * an empty void. It is injected into the REAL rendering pipeline (nodes,
 * edges, clusters), exactly like the tutorial's demo node, so it gets the
 * true look of a populated map for free: cluster colors and halos, native
 * labels, ambient drift, the works. Curated to read like a real person's
 * saves, never lorem-ipsum.
 *
 * A beat after first paint one more node arrives — its live timestamp gives
 * it the amber "recent" styling and ring every real capture wears, and the
 * render tween eases it in from its nearest neighbour: the product's verb,
 * performed once, nothing asked.
 *
 * The whole thing vanishes the moment the user's first real capture lands
 * (the injection is gated on the server corpus count), and ghost nodes are
 * excluded from hit-testing, the summary strip, and sharing.
 */

type GraphNode = MemoryGraphResponse['nodes'][number];
type GraphEdge = MemoryGraphResponse['edges'][number];
type GraphCluster = MemoryGraphResponse['clusters'][number];

export const GHOST_ID_PREFIX = 'ghost-';

export function isGhostId(id: string): boolean {
  return id.startsWith(GHOST_ID_PREFIX);
}

/** How long the map holds the stage alone before the welcome pill speaks.
 * Short on purpose: a brand-new user shouldn't sit staring at a map they
 * don't understand yet. */
export const GHOST_PROMPT_MS = 1500;
/** When the arriving node performs its entrance. */
export const GHOST_ARRIVE_MS = 1600;

// Base nodes are dated well past the "recent" window (14 days) so none of
// them wear the amber ring — that styling is reserved for the arrival.
const AGED = '2026-06-10T09:00:00.000Z';

const T = {
  phil: { topicId: 'ghost-d-philosophy', name: 'philosophy', kind: 'general' as const },
  design: { topicId: 'ghost-d-design', name: 'design', kind: 'general' as const },
  psych: { topicId: 'ghost-d-psychology', name: 'psychology', kind: 'general' as const },
  science: { topicId: 'ghost-d-science', name: 'science', kind: 'general' as const },
  attention: { topicId: 'ghost-t-attention', name: 'attention', kind: 'specific' as const },
  craft: { topicId: 'ghost-t-craft', name: 'craft', kind: 'specific' as const },
  memory: { topicId: 'ghost-t-memory', name: 'memory', kind: 'specific' as const },
  systems: { topicId: 'ghost-t-systems', name: 'systems', kind: 'specific' as const },
};

function ghostNode(
  id: string,
  label: string,
  kind: GraphNode['kind'],
  topics: (typeof T)[keyof typeof T][],
  x: number,
  y: number,
): GraphNode {
  return {
    id: `${GHOST_ID_PREFIX}${id}`,
    label,
    kind,
    topics,
    capturedAt: AGED,
    reaction: null,
    keyIdea: null,
    x,
    y,
  };
}

export const GHOST_NODES: GraphNode[] = [
  // attention — a thinking cluster (philosophy).
  ghostNode('depth', 'deep work — on depth', 'LINK', [T.phil, T.attention], 0.32, 0.26),
  ghostNode('walks', 'walking unsticks thinking', 'TEXT', [T.phil, T.attention], 0.41, 0.32),
  ghostNode('generosity', 'attention is generosity', 'TEXT', [T.phil, T.attention], 0.33, 0.39),
  ghostNode('tabs', 'why 40 open tabs feel heavy', 'TEXT', [T.phil, T.attention], 0.25, 0.33),
  ghostNode('boredom', 'in defense of boredom', 'LINK', [T.phil, T.attention], 0.4, 0.22),
  // craft — a making cluster (design).
  ghostNode('kintsugi', 'kintsugi — repair as ornament', 'LINK', [T.design, T.craft], 0.64, 0.34),
  ghostNode('shokunin', 'the shokunin ideal', 'LINK', [T.design, T.craft], 0.72, 0.41),
  ghostNode('notebooks', "da vinci's notebooks", 'LINK', [T.design, T.craft], 0.61, 0.45),
  ghostNode('negative', 'negative space does the work', 'TEXT', [T.design, T.craft], 0.7, 0.5),
  ghostNode('doors', 'why old doors feel better', 'TEXT', [T.design, T.craft], 0.78, 0.33),
  // memory — a remembering cluster (psychology).
  ghostNode('forgetting', 'we forget on purpose', 'LINK', [T.psych, T.memory], 0.42, 0.64),
  ghostNode('kyoto', 'a bridge in kyoto', 'IMAGE', [T.psych, T.memory], 0.5, 0.7),
  ghostNode('spacing', 'the spacing effect', 'LINK', [T.psych, T.memory], 0.35, 0.71),
  ghostNode('smell', 'smell is a time machine', 'TEXT', [T.psych, T.memory], 0.44, 0.76),
  // systems — a how-things-work cluster (science).
  ghostNode('meadows', 'thinking in systems — meadows', 'LINK', [T.science, T.systems], 0.66, 0.63),
  ghostNode('ants', 'ant colonies vote', 'LINK', [T.science, T.systems], 0.74, 0.69),
  ghostNode('cities', 'cities behave like organisms', 'LINK', [T.science, T.systems], 0.62, 0.72),
  // strays — every real map has them.
  ghostNode('tides', 'why tides never stop', 'TEXT', [T.psych], 0.22, 0.55),
  ghostNode('song', 'a song stuck since tuesday', 'TEXT', [T.phil], 0.55, 0.2),
];

function ghostEdge(from: string, to: string, type: GraphEdge['type'], weight: number): GraphEdge {
  return {
    fromItemId: `${GHOST_ID_PREFIX}${from}`,
    toItemId: `${GHOST_ID_PREFIX}${to}`,
    type,
    weight,
  };
}

export const GHOST_EDGES: GraphEdge[] = [
  ghostEdge('depth', 'walks', 'REINFORCES', 0.58),
  ghostEdge('walks', 'generosity', 'RELATED', 0.46),
  ghostEdge('depth', 'tabs', 'CONTRADICTS', 0.52),
  ghostEdge('boredom', 'depth', 'REINFORCES', 0.54),
  ghostEdge('boredom', 'walks', 'RELATED', 0.43),
  ghostEdge('kintsugi', 'shokunin', 'REINFORCES', 0.61),
  ghostEdge('shokunin', 'notebooks', 'RELATED', 0.44),
  ghostEdge('notebooks', 'negative', 'RELATED', 0.42),
  ghostEdge('doors', 'kintsugi', 'RELATED', 0.45),
  ghostEdge('doors', 'shokunin', 'REINFORCES', 0.4),
  ghostEdge('forgetting', 'spacing', 'REINFORCES', 0.55),
  ghostEdge('forgetting', 'kyoto', 'RELATED', 0.4),
  ghostEdge('smell', 'kyoto', 'RELATED', 0.47),
  ghostEdge('smell', 'forgetting', 'RELATED', 0.39),
  ghostEdge('meadows', 'ants', 'REINFORCES', 0.56),
  ghostEdge('meadows', 'cities', 'REINFORCES', 0.53),
  ghostEdge('ants', 'cities', 'RELATED', 0.48),
  // cross-cluster bridges, the way real maps surprise you.
  ghostEdge('negative', 'generosity', 'RELATED', 0.38),
  ghostEdge('cities', 'notebooks', 'RELATED', 0.36),
  ghostEdge('spacing', 'depth', 'EVOLVES_FROM', 0.37),
];

/**
 * The arriving node. `capturedAt` is stamped at injection time so it lands
 * inside the "recent" window and wears the amber ring real captures wear.
 */
export const GHOST_ARRIVAL_BASE: Omit<GraphNode, 'capturedAt'> = {
  id: `${GHOST_ID_PREFIX}extended`,
  label: 'the extended mind',
  kind: 'TEXT',
  topics: [T.phil, T.attention],
  reaction: null,
  keyIdea: null,
  x: 0.46,
  y: 0.29,
};

export const GHOST_ARRIVAL_EDGES: GraphEdge[] = [
  ghostEdge('extended', 'walks', 'REINFORCES', 0.57),
  ghostEdge('extended', 'depth', 'RELATED', 0.41),
];

function cluster(
  topic: (typeof T)[keyof typeof T],
  kind: GraphCluster['kind'],
  memberIds: string[],
): GraphCluster {
  const itemIds = memberIds.map((id) => `${GHOST_ID_PREFIX}${id}`);
  return { topicId: topic.topicId, name: topic.name, kind, count: itemIds.length, itemIds };
}

const ATTENTION_IDS = ['depth', 'walks', 'generosity', 'tabs', 'boredom'];
const CRAFT_IDS = ['kintsugi', 'shokunin', 'notebooks', 'negative', 'doors'];
const MEMORY_IDS = ['forgetting', 'kyoto', 'spacing', 'smell'];
const SYSTEMS_IDS = ['meadows', 'ants', 'cities'];

export const GHOST_CLUSTERS: GraphCluster[] = [
  // Domains carry the zoomed-out labels and halos…
  cluster(T.phil, 'domain', [...ATTENTION_IDS, 'song']),
  cluster(T.design, 'domain', CRAFT_IDS),
  cluster(T.psych, 'domain', [...MEMORY_IDS, 'tides']),
  cluster(T.science, 'domain', SYSTEMS_IDS),
  // …and the specific topics take over as the camera comes in.
  cluster(T.attention, 'topic', ATTENTION_IDS),
  cluster(T.craft, 'topic', CRAFT_IDS),
  cluster(T.memory, 'topic', MEMORY_IDS),
  cluster(T.systems, 'topic', SYSTEMS_IDS),
];
