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
