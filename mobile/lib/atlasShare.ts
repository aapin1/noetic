/**
 * Pure framing + copy for the "share your atlas" card. Kept free of React and
 * of the Atlas screen's camera machinery: the share render is a one-shot
 * offscreen composition with its own fit-all camera, not a screenshot of the
 * live map, so all it needs is "given these points, where do they land inside
 * a fixed frame". No imports so the backend test runner can execute it as-is.
 */

export interface AtlasSharePoint {
  x: number;
  y: number;
}

export interface AtlasShareFrame {
  width: number;
  height: number;
  /** Clear air kept between the outermost node and the frame edge. */
  pad: number;
}

/** screenX = tx + x * scale, screenY = ty + y * scale. */
export interface AtlasShareFit {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * A tiny map must not be blown up until two neighbouring thoughts sit at
 * opposite corners of the card — that reads as noise, not as a mind. Spreads
 * below this floor (in the server's normalized [0,1] coordinate space) render
 * as a generous centred cluster instead of filling the frame.
 */
export const MIN_FIT_SPREAD = 0.35;

/**
 * Fit-all camera for the share frame: uniform scale (no aspect distortion),
 * point-cloud centroid on the frame centre, everything inside `pad`.
 * Degenerate clouds (one node, or several at near-identical coordinates)
 * compose as a centred constellation at the floor spread rather than
 * exploding to the edges. Returns null only for an empty cloud.
 */
export function fitAtlasFrame(
  points: AtlasSharePoint[],
  frame: AtlasShareFrame,
): AtlasShareFit | null {
  if (points.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }

  const spanX = Math.max(maxX - minX, MIN_FIT_SPREAD);
  const spanY = Math.max(maxY - minY, MIN_FIT_SPREAD);
  const innerW = Math.max(1, frame.width - frame.pad * 2);
  const innerH = Math.max(1, frame.height - frame.pad * 2);
  const scale = Math.min(innerW / spanX, innerH / spanY);

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    scale,
    tx: frame.width / 2 - cx * scale,
    ty: frame.height / 2 - cy * scale,
  };
}

export function projectAtlasPoint(p: AtlasSharePoint, fit: AtlasShareFit): AtlasSharePoint {
  return { x: fit.tx + p.x * fit.scale, y: fit.ty + p.y * fit.scale };
}

/**
 * Node radius for the share card. A 3-node atlas wants big luminous marks; at
 * hundreds of points the same marks would smear into paste, so radius falls
 * with the square root of the count and settles at the live map's dot size.
 */
export function atlasNodeRadius(count: number): number {
  if (count <= 0) return 0;
  return Math.min(9, Math.max(2.4, 16 / Math.sqrt(count)));
}

/** "214 points · 37 fields" — same voice as the Atlas summary strip. */
export function atlasStatLine(pointCount: number, fieldCount: number): string {
  const points = `${pointCount} ${pointCount === 1 ? 'point' : 'points'}`;
  if (fieldCount <= 0) return points;
  return `${points} · ${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`;
}

/** "AUG 2026" — the chart's date stamp. */
export function atlasMonthStamp(date: Date): string {
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// ── Scene ─────────────────────────────────────────────────────────
// The whole composition of the chart as plain data, so the RN card and a
// browser harness draw the identical picture. Modelled on the live Atlas:
// a soft colour wash per field, one ink for points, edges faded by weight,
// and a field's name set as a colour dot + mono caption, never as coloured
// type across the map.

export interface AtlasSceneNode {
  id: string;
  x?: number | null;
  y?: number | null;
}
export interface AtlasSceneEdge {
  fromItemId: string;
  toItemId: string;
  type: string;
  weight: number;
}
export interface AtlasSceneCluster {
  topicId: string;
  name: string;
  kind: 'domain' | 'topic';
  count: number;
  itemIds: string[];
}

export interface AtlasScene {
  washes: { key: string; cx: number; cy: number; r: number; color: string }[];
  links: { key: string; x1: number; y1: number; x2: number; y2: number; opacity: number; width: number; dashed: boolean }[];
  stars: { id: string; cx: number; cy: number; r: number; hub: boolean }[];
  labels: { key: string; text: string; x: number; y: number; color: string; fontSize: number; width: number }[];
  /** Point radius the whole scene was sized from. */
  baseR: number;
}

export interface AtlasSceneOptions {
  width: number;
  height: number;
  showLabels: boolean;
  colorFor: (topicId: string) => string;
  /** Stable hash for nodes the server sent without coordinates. */
  hash: (id: string) => number;
}

const MAJOR_CLUSTER_MIN = 2;
/** Hub glow only on dense maps — on a 6-point map every point is a hub. */
const HUB_MIN_NODES = 25;
/** Past this many edges the graph is fuzz at card size; keep the strongest. */
const MAX_LINKS = 420;

/** Label count and size step down as the map fills, so names never crowd it. */
export function atlasLabelBudget(nodeCount: number): { max: number; fontSize: number } {
  if (nodeCount < 12) return { max: 3, fontSize: 10.5 };
  if (nodeCount < 40) return { max: 5, fontSize: 10 };
  if (nodeCount < 120) return { max: 7, fontSize: 9.5 };
  return { max: 8, fontSize: 9 };
}

/** Width a mono label occupies, dot and gap included, at `fontSize`. */
export function atlasLabelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.66 + fontSize * 1.4;
}

export function buildAtlasScene(
  nodes: AtlasSceneNode[],
  edges: AtlasSceneEdge[],
  clusters: AtlasSceneCluster[],
  o: AtlasSceneOptions,
): AtlasScene {
  const empty: AtlasScene = { washes: [], links: [], stars: [], labels: [], baseR: 0 };
  const positions = new Map<string, AtlasSharePoint>();
  for (const n of nodes) {
    if (typeof n.x === 'number' && typeof n.y === 'number') positions.set(n.id, { x: n.x, y: n.y });
    else {
      const h = o.hash(n.id);
      positions.set(n.id, { x: 0.15 + ((h % 997) / 997) * 0.7, y: 0.15 + ((Math.floor(h / 997) % 997) / 997) * 0.7 });
    }
  }
  const fit = fitAtlasFrame([...positions.values()], {
    width: o.width,
    height: o.height,
    pad: Math.max(24, o.width * 0.12),
  });
  if (!fit) return empty;
  const at = (id: string) => projectAtlasPoint(positions.get(id)!, fit);

  const domainClusters = clusters.filter((cl) => cl.kind === 'domain' && cl.count >= MAJOR_CLUSTER_MIN);
  const fields = (domainClusters.length > 0 ? domainClusters : clusters.filter((cl) => cl.count >= MAJOR_CLUSTER_MIN))
    .map((cl) => ({ cl, pts: cl.itemIds.filter((id) => positions.has(id)).map(at) }))
    .filter((f) => f.pts.length >= MAJOR_CLUSTER_MIN)
    .sort((a, b) => b.cl.count - a.cl.count);

  const centroid = (pts: AtlasSharePoint[]) => ({
    x: pts.reduce((s, q) => s + q.x, 0) / pts.length,
    y: pts.reduce((s, q) => s + q.y, 0) / pts.length,
  });

  // Washes: the live map's region halos. Radius follows the cluster's spread
  // so a tight field glows tightly and a loose one glows loosely.
  const washes: AtlasScene['washes'] = fields.map(({ cl, pts }) => {
    const c = centroid(pts);
    const spread = pts.reduce((s, q) => s + Math.hypot(q.x - c.x, q.y - c.y), 0) / pts.length;
    const r = Math.max(Math.min(o.width, o.height) * 0.12, Math.min(spread * 1.9, Math.min(o.width, o.height) * 0.3));
    return { key: cl.topicId, cx: c.x, cy: c.y, r, color: o.colorFor(cl.topicId) };
  });

  // Links: weight → salience, exactly the Atlas's ramp.
  const valid = edges.filter((e) => positions.has(e.fromItemId) && positions.has(e.toItemId));
  const weights = valid.map((e) => e.weight);
  const wMin = Math.min(...weights, Infinity);
  const wMax = Math.max(...weights, -Infinity);
  const salience = (w: number) => (wMax > wMin ? (w - wMin) / (wMax - wMin) : 0.5);
  const kept = [...valid].sort((a, b) => b.weight - a.weight).slice(0, MAX_LINKS);
  const links: AtlasScene['links'] = kept.map((e) => {
    const a = at(e.fromItemId);
    const b = at(e.toItemId);
    const s = salience(e.weight);
    const dashed = e.type === 'CONTRADICTS';
    return {
      key: `${e.fromItemId}-${e.toItemId}`,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      opacity: dashed ? 0.3 : 0.1 + s * 0.32,
      width: dashed ? 0.7 : 0.45 + s * 0.5,
      dashed,
    };
  });

  // Stars: degree nudges size so the ideas everything hangs off read as hubs.
  const degree = new Map<string, number>();
  for (const e of valid) {
    degree.set(e.fromItemId, (degree.get(e.fromItemId) ?? 0) + 1);
    degree.set(e.toItemId, (degree.get(e.toItemId) ?? 0) + 1);
  }
  const maxDeg = Math.max(1, ...degree.values());
  const baseR = atlasNodeRadius(nodes.length);
  const hubIds = new Set(
    nodes.length >= HUB_MIN_NODES
      ? [...degree.entries()].filter(([, d]) => d >= 3).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id)
      : [],
  );
  const stars: AtlasScene['stars'] = nodes.map((n) => {
    const pt = at(n.id);
    const d = degree.get(n.id) ?? 0;
    return { id: n.id, cx: pt.x, cy: pt.y, r: baseR * (0.85 + (d / maxDeg) * 0.5), hub: hubIds.has(n.id) };
  });

  // Labels: dot + name, parked just above or below its field where it covers
  // the fewest points. Measured-width declutter; a skipped name beats an
  // overlapping one.
  const labels: AtlasScene['labels'] = [];
  if (o.showLabels) {
    const { max, fontSize } = atlasLabelBudget(nodes.length);
    const allPts = nodes.map((n) => at(n.id));
    const placed: { x: number; y: number; w: number }[] = [];
    const rowH = fontSize * 1.5;
    const collides = (x: number, y: number, w: number) =>
      placed.some((l) => Math.abs(l.y - y) < rowH && Math.abs(l.x - x) < (w + l.w) / 2 + 8);
    for (const { cl, pts } of fields) {
      if (labels.length >= max) break;
      const text = cl.name.toLowerCase();
      const w = atlasLabelWidth(text, fontSize);
      const c = centroid(pts);
      const x = Math.max(w / 2 + 6, Math.min(o.width - w / 2 - 6, c.x));
      const crowding = (y: number) =>
        allPts.reduce((s, q) => (Math.abs(q.y - y) < fontSize * 0.8 && Math.abs(q.x - x) < w / 2 + 4 ? s + 1 : s), 0);
      const top = Math.min(...pts.map((q) => q.y));
      const bottom = Math.max(...pts.map((q) => q.y));
      const gap = baseR + fontSize * 0.9;
      const candidates = [top - gap, bottom + gap + fontSize * 0.3, top - gap - rowH, bottom + gap + rowH]
        .map((y) => Math.max(fontSize + 4, Math.min(o.height - 8, y)))
        .filter((y) => !collides(x, y, w))
        .sort((a, b) => crowding(a) - crowding(b));
      // A name that would sit on top of a pile of points is worse than none.
      if (candidates.length === 0 || crowding(candidates[0]!) > 2) continue;
      const y = candidates[0]!;
      placed.push({ x, y, w });
      labels.push({ key: cl.topicId, text, x, y, color: o.colorFor(cl.topicId), fontSize, width: w });
    }
  }

  return { washes, links, stars, labels, baseR };
}

/** Mix a #rrggbb colour toward black — light-card contrast for field hues. */
export function darkenHex(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - t));
  const g = Math.round(((n >> 8) & 255) * (1 - t));
  const b = Math.round((n & 255) * (1 - t));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
