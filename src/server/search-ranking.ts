/**
 * The blended archive-search score: exact text tiers plus a semantic layer.
 *
 * The text side keeps rankTextMatch's ladder (exact 100, prefix 80, contains
 * 50). The semantic side maps the query↔capture embedding cosine onto 0–45:
 * zero below SEMANTIC_MIN_SIM, the full scale only at an (unreachable) cosine
 * of 1. The 45 cap is the contract that "exact matches still win": a pure
 * semantic hit can never outscore a contains match plus any semantic signal
 * of its own, and prefix/exact tiers stay decisive against everything below
 * them. What the layer buys is recall — "that pasta thing" finds the risotto
 * essay that never says pasta — and ordering within a text tier.
 */

/** Below this cosine the capture is unrelated to the query, not just distant.
 * text-embedding-3-small puts unrelated pairs around 0–0.2 and genuinely
 * related ones above ~0.3. */
export const SEMANTIC_MIN_SIM = 0.3;
const SEMANTIC_SCALE = 45;

export function semanticScore(similarity: number): number {
  if (similarity < SEMANTIC_MIN_SIM) return 0;
  return ((similarity - SEMANTIC_MIN_SIM) / (1 - SEMANTIC_MIN_SIM)) * SEMANTIC_SCALE;
}

/** Best text match across every field a capture can be found by. */
export function rankCaptureText(fields: (string | null | undefined)[], query: string): number {
  let best = 0;
  for (const field of fields) {
    if (!field) continue;
    best = Math.max(best, rankTextMatch(field, query));
  }
  return best;
}

export function blendSearchScore(textScore: number, similarity: number): number {
  return textScore + semanticScore(similarity);
}

export function rankTextMatch(target: string, query: string) {
  const normalizedTarget = target.trim().toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedTarget === normalizedQuery) {
    return 100;
  }

  if (normalizedTarget.startsWith(normalizedQuery)) {
    return 80;
  }

  if (normalizedTarget.includes(normalizedQuery)) {
    return 50;
  }

  return 0;
}
