/**
 * The ghost map: a faint, fully-formed example constellation a brand-new user
 * arrives to, so the first thing they see is the destination — a mind, mapped —
 * not an empty void. Curated to read like a real person's saves (links,
 * fragments, a memory), never lorem-ipsum. It performs the product's one verb
 * once: a node arrives, gets read, and connects. When the user's first real
 * node lands, the ghost dissolves and their map begins.
 *
 * Coordinates are fractions of the layout rect, same convention as the server
 * graph's normalized x/y, chosen to sit inside the initial camera.
 */

export type GhostNode = {
  id: string;
  /** Lowercase, terse — the voice of a label someone actually saved. */
  label: string;
  x: number;
  y: number;
};

export type GhostEdge = { from: string; to: string };

export const GHOST_NODES: GhostNode[] = [
  // A cluster about attention.
  { id: 'g-depth', label: 'deep work — on depth', x: 0.36, y: 0.3 },
  { id: 'g-walks', label: 'walking unsticks thinking', x: 0.44, y: 0.38 },
  { id: 'g-attention', label: 'attention is generosity', x: 0.38, y: 0.46 },
  // A cluster about making.
  { id: 'g-kintsugi', label: 'kintsugi — repair as ornament', x: 0.61, y: 0.43 },
  { id: 'g-shokunin', label: 'the shokunin ideal', x: 0.68, y: 0.51 },
  { id: 'g-notebooks', label: "da vinci's notebooks", x: 0.58, y: 0.57 },
  // Strays — every real map has them.
  { id: 'g-kyoto', label: 'a bridge in kyoto', x: 0.49, y: 0.65 },
  { id: 'g-tides', label: 'why tides never stop', x: 0.28, y: 0.56 },
];

export const GHOST_EDGES: GhostEdge[] = [
  { from: 'g-depth', to: 'g-walks' },
  { from: 'g-walks', to: 'g-attention' },
  { from: 'g-kintsugi', to: 'g-shokunin' },
  { from: 'g-shokunin', to: 'g-notebooks' },
  { from: 'g-kyoto', to: 'g-notebooks' },
];

/**
 * The performance: this node arrives a beat after the constellation is seen,
 * gets read (the amber ring real captures wear), then its edge draws in —
 * the destination and the verb, shown, nothing asked.
 */
export const GHOST_ARRIVAL: GhostNode = {
  id: 'g-extended',
  label: 'the extended mind',
  x: 0.47,
  y: 0.32,
};

export const GHOST_ARRIVAL_EDGE: GhostEdge = { from: 'g-extended', to: 'g-walks' };

/** Phase timings, ms after the ghost first shows. */
export const GHOST_ARRIVE_MS = 1800;
export const GHOST_READ_MS = 3400;
export const GHOST_CONNECT_MS = 4800;
