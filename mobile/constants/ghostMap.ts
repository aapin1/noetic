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

/** How long the map holds the stage alone before the prompt card appears. */
export const GHOST_PROMPT_MS = 3500;
/** When the arriving node performs its entrance. */
export const GHOST_ARRIVE_MS = 1600;

// Base nodes are dated well past the "recent" window (14 days) so none of
// them wear the amber ring — that styling is reserved for the arrival.
const AGED = '2026-06-10T09:00:00.000Z';

const T = {
  phil: { topicId: 'ghost-d-philosophy', name: 'philosophy', kind: 'general' as const },
  design: { topicId: 'ghost-d-design', name: 'design', kind: 'general' as const },
  psych: { topicId: 'ghost-d-psychology', name: 'psychology', kind: 'general' as const },
  attention: { topicId: 'ghost-t-attention', name: 'attention', kind: 'specific' as const },
  craft: { topicId: 'ghost-t-craft', name: 'craft', kind: 'specific' as const },
  memory: { topicId: 'ghost-t-memory', name: 'memory', kind: 'specific' as const },
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
  ghostNode('depth', 'deep work — on depth', 'LINK', [T.phil, T.attention], 0.34, 0.3),
  ghostNode('walks', 'walking unsticks thinking', 'TEXT', [T.phil, T.attention], 0.42, 0.36),
  ghostNode('generosity', 'attention is generosity', 'TEXT', [T.phil, T.attention], 0.35, 0.43),
  ghostNode('tabs', 'why 40 open tabs feel heavy', 'TEXT', [T.phil, T.attention], 0.27, 0.37),
  // craft — a making cluster (design).
  ghostNode('kintsugi', 'kintsugi — repair as ornament', 'LINK', [T.design, T.craft], 0.63, 0.4),
  ghostNode('shokunin', 'the shokunin ideal', 'LINK', [T.design, T.craft], 0.7, 0.47),
  ghostNode('notebooks', "da vinci's notebooks", 'LINK', [T.design, T.craft], 0.6, 0.52),
  ghostNode('negative', 'negative space does the work', 'TEXT', [T.design, T.craft], 0.68, 0.56),
  // memory — a remembering cluster (psychology).
  ghostNode('forgetting', 'we forget on purpose', 'LINK', [T.psych, T.memory], 0.45, 0.62),
  ghostNode('kyoto', 'a bridge in kyoto', 'IMAGE', [T.psych, T.memory], 0.52, 0.68),
  ghostNode('spacing', 'the spacing effect', 'LINK', [T.psych, T.memory], 0.38, 0.68),
  // a stray — every real map has one.
  ghostNode('tides', 'why tides never stop', 'TEXT', [T.psych], 0.24, 0.55),
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
  ghostEdge('kintsugi', 'shokunin', 'REINFORCES', 0.61),
  ghostEdge('shokunin', 'notebooks', 'RELATED', 0.44),
  ghostEdge('notebooks', 'negative', 'RELATED', 0.42),
  ghostEdge('forgetting', 'spacing', 'REINFORCES', 0.55),
  ghostEdge('forgetting', 'kyoto', 'RELATED', 0.4),
  // one cross-cluster bridge, the way real maps surprise you.
  ghostEdge('negative', 'generosity', 'RELATED', 0.38),
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

const ATTENTION_IDS = ['depth', 'walks', 'generosity', 'tabs'];
const CRAFT_IDS = ['kintsugi', 'shokunin', 'notebooks', 'negative'];
const MEMORY_IDS = ['forgetting', 'kyoto', 'spacing'];

export const GHOST_CLUSTERS: GraphCluster[] = [
  // Domains carry the zoomed-out labels and halos…
  cluster(T.phil, 'domain', ATTENTION_IDS),
  cluster(T.design, 'domain', CRAFT_IDS),
  cluster(T.psych, 'domain', [...MEMORY_IDS, 'tides']),
  // …and the specific topics take over as the camera comes in.
  cluster(T.attention, 'topic', ATTENTION_IDS),
  cluster(T.craft, 'topic', CRAFT_IDS),
  cluster(T.memory, 'topic', MEMORY_IDS),
];
