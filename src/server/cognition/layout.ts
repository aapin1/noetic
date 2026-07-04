/**
 * Deterministic semantic layout.
 *
 * Projects high-dimensional capture embeddings into stable 2D coordinates so
 * that captures with similar meaning land near each other and dissimilar ones
 * land far apart. Uses SMACOF stress-majorization (the Guttman transform) over
 * the cosine-distance matrix, with a deterministic seeded initialization.
 *
 * Determinism matters: the map must render identically every time the same set
 * of captures is laid out (e.g. when the user switches lenses and returns), so
 * there is NO randomness beyond a fixed per-id seed.
 */

export type LayoutPoint = { x: number; y: number };

function seededRng(seed: number): () => number {
  let v = seed % 233280 || 1;
  return () => {
    v = (v * 9301 + 49297) % 233280;
    return v / 233280;
  };
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm < 1e-12) return vec;
  return vec.map((v) => v / norm);
}

/** Cosine similarity of two vectors (normalized internally). */
export function cosineSim(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na < 1e-12 || nb < 1e-12) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Lays out items with embeddings into normalized [0,1] x/y coordinates.
 * Items without a usable embedding are placed deterministically around the
 * periphery so they never collapse onto the semantic core.
 */
export function semanticLayout(
  items: { id: string; embedding: number[] | null | undefined }[],
  iterations = 160,
): Record<string, LayoutPoint> {
  const result: Record<string, LayoutPoint> = {};
  if (items.length === 0) return result;

  const withEmb = items.filter(
    (it): it is { id: string; embedding: number[] } =>
      Array.isArray(it.embedding) && it.embedding.length > 0,
  );
  const withoutEmb = items.filter(
    (it) => !Array.isArray(it.embedding) || it.embedding.length === 0,
  );

  if (withEmb.length === 1) {
    result[withEmb[0]!.id] = { x: 0.5, y: 0.5 };
  } else if (withEmb.length >= 2) {
    const n = withEmb.length;
    const vecs = withEmb.map((it) => normalize(it.embedding));

    // Target distances: 1 - cosine, clamped to [0, 1].
    const dist: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = Math.min(1, Math.max(0, 1 - cosineSim(vecs[i]!, vecs[j]!)));
        dist[i]![j] = d;
        dist[j]![i] = d;
      }
    }

    // Deterministic seeded initialization.
    const X: LayoutPoint[] = withEmb.map((it) => {
      const rng = seededRng(hashId(it.id));
      return { x: rng(), y: rng() };
    });

    // SMACOF / Guttman transform with uniform weights.
    for (let iter = 0; iter < iterations; iter++) {
      const next: LayoutPoint[] = X.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) {
        let sx = 0;
        let sy = 0;
        for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const dx = X[i]!.x - X[j]!.x;
          const dy = X[i]!.y - X[j]!.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
          const ratio = dist[i]![j]! / d;
          sx += X[j]!.x + ratio * dx;
          sy += X[j]!.y + ratio * dy;
        }
        next[i] = { x: sx / (n - 1), y: sy / (n - 1) };
      }
      for (let i = 0; i < n; i++) X[i] = next[i]!;
    }

    // Normalize to [0,1] with a small interior margin.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of X) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const margin = 0.08;
    const scale = 1 - margin * 2;
    withEmb.forEach((it, i) => {
      result[it.id] = {
        x: margin + ((X[i]!.x - minX) / spanX) * scale,
        y: margin + ((X[i]!.y - minY) / spanY) * scale,
      };
    });
  }

  // Items without embeddings: deterministic ring on the periphery.
  withoutEmb.forEach((it) => {
    result[it.id] = peripheralPoint(it.id);
  });

  return result;
}

/** Deterministic point on the periphery, seeded by id (for un-embeddable items). */
export function peripheralPoint(id: string): LayoutPoint {
  const angle = (hashId(id) % 360) * (Math.PI / 180);
  return { x: 0.5 + 0.46 * Math.cos(angle), y: 0.5 + 0.46 * Math.sin(angle) };
}

/**
 * Places ONE new node into an existing layout without moving the anchors.
 *
 * Finds the 2D point whose distances to the already-positioned anchors best
 * match the embedding (cosine) distances — weighted toward the most similar
 * anchors, so the node lands next to what it's about and away from what it
 * isn't. Anchors are never modified, so the rest of the map stays put.
 *
 * Returns null when placement isn't possible (no embedding, or no usable
 * anchors) — the caller decides the fallback.
 */
export function placeNewNode(
  embedding: number[] | null | undefined,
  anchors: { x: number; y: number; embedding?: number[] | null }[],
  iterations = 140,
): LayoutPoint | null {
  if (!Array.isArray(embedding) || embedding.length === 0) return null;

  const valid = anchors.filter(
    (a): a is { x: number; y: number; embedding: number[] } =>
      Array.isArray(a.embedding) &&
      a.embedding.length > 0 &&
      Number.isFinite(a.x) &&
      Number.isFinite(a.y),
  );
  if (valid.length === 0) return null;

  const e = normalize(embedding);
  const anchorVecs = valid.map((a) => normalize(a.embedding));

  const targets = valid.map((a, i) => {
    const sim = cosineSim(e, anchorVecs[i]!);
    return {
      x: a.x,
      y: a.y,
      d: Math.min(1, Math.max(0, 1 - sim)),
      w: Math.max(0.0001, (sim + 1) / 2), // map cosine [-1,1] → weight (0,1]
    };
  });

  // Calibrate embedding distances to the layout's 2D distance scale.
  let geoSum = 0;
  let embSum = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      geoSum += Math.hypot(valid[i]!.x - valid[j]!.x, valid[i]!.y - valid[j]!.y);
      embSum += Math.min(1, Math.max(0, 1 - cosineSim(anchorVecs[i]!, anchorVecs[j]!)));
    }
  }
  const scale = embSum > 1e-6 ? geoSum / embSum : 1;

  // Initialize at the similarity-weighted centroid of the anchors.
  let px = 0;
  let py = 0;
  let wsum = 0;
  for (const t of targets) {
    const w = t.w * t.w;
    px += t.x * w;
    py += t.y * w;
    wsum += w;
  }
  let p: LayoutPoint = wsum > 0 ? { x: px / wsum, y: py / wsum } : { x: 0.5, y: 0.5 };
  // Nudge off any exact anchor coincidence so the first gradient is well-defined.
  p = { x: p.x + 1e-3, y: p.y - 1e-3 };

  const totalW = targets.reduce((a, t) => a + t.w, 0) || 1;
  const lr = 0.12;
  for (let it = 0; it < iterations; it++) {
    let gx = 0;
    let gy = 0;
    for (const t of targets) {
      const dx = p.x - t.x;
      const dy = p.y - t.y;
      const dist = Math.hypot(dx, dy) || 1e-9;
      const coeff = (2 * t.w * (dist - scale * t.d)) / dist;
      gx += coeff * dx;
      gy += coeff * dy;
    }
    p = {
      x: Math.min(0.95, Math.max(0.05, p.x - (lr * gx) / (2 * totalW))),
      y: Math.min(0.95, Math.max(0.05, p.y - (lr * gy) / (2 * totalW))),
    };
  }

  return p;
}
