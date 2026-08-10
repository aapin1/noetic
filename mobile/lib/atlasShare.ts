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

// ── Constellation geometry ────────────────────────────────────────
// The card draws each field as a constellation: a minimum spanning tree for
// the linework (the full similarity graph reads as fuzz at card size) and a
// smoothed convex hull for the dashed field boundary.

/** Prim's MST over a point list → index pairs. O(n²), n is a cluster's size. */
export function mstEdges(pts: AtlasSharePoint[]): [number, number][] {
  const n = pts.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  const dist = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  dist[0] = 0;
  const out: [number, number][] = [];
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u === -1 || dist[i]! < dist[u]!)) u = i;
    inTree[u] = true;
    if (parent[u] !== -1) out.push([parent[u]!, u]);
    for (let v = 0; v < n; v++) {
      if (inTree[v]) continue;
      const d = Math.hypot(pts[u]!.x - pts[v]!.x, pts[u]!.y - pts[v]!.y);
      if (d < dist[v]!) { dist[v] = d; parent[v] = u; }
    }
  }
  return out;
}

/** Andrew monotone-chain convex hull → boundary points in order. */
export function convexHull(pts: AtlasSharePoint[]): AtlasSharePoint[] {
  if (pts.length < 3) return [...pts];
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: AtlasSharePoint, a: AtlasSharePoint, b: AtlasSharePoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: AtlasSharePoint[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: AtlasSharePoint[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

/** Push each hull vertex outward from the hull's centroid by `pad`. */
export function expandHull(hull: AtlasSharePoint[], pad: number): AtlasSharePoint[] {
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  return hull.map((p) => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + ((p.x - cx) / d) * pad, y: p.y + ((p.y - cy) / d) * pad };
  });
}

/** Closed smooth SVG path through points: quadratics via edge midpoints. */
export function smoothClosedPath(pts: AtlasSharePoint[]): string {
  if (pts.length < 3) return '';
  const mid = (a: AtlasSharePoint, b: AtlasSharePoint) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    const m = mid(p, next);
    if (i === 0) {
      const prevM = mid(pts[pts.length - 1]!, p);
      d = `M ${prevM.x.toFixed(1)} ${prevM.y.toFixed(1)}`;
    }
    d += ` Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
  }
  return d + ' Z';
}

/** Mix a #rrggbb colour toward black — light-card contrast for field hues. */
export function darkenHex(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - t));
  const g = Math.round(((n >> 8) & 255) * (1 - t));
  const b = Math.round((n & 255) * (1 - t));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
