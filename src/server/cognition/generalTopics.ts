/**
 * Canonical list of GENERAL topics — the coarse fields every node is filed
 * under. Kept coarse on purpose so similar captures land in the same region of
 * the map even when their specific sub-topics differ ("neuroscience" vs
 * "cognitive neuroscience").
 *
 * A node's general topic is always one of these; its SPECIFIC topics are
 * AI-generated fine-grained labels that are never in this set. That lets every
 * read surface derive a topic's kind by simple membership — no schema column.
 *
 * This list used to mirror a topic picker shown during onboarding. That screen
 * is gone: asking someone to name their interests before they had saved
 * anything produced a worse signal than watching what they actually save. The
 * list stayed because classification still needs a fixed coarse vocabulary.
 */
export const GENERAL_TOPICS = [
  "philosophy", "psychology", "economics", "history", "science", "literature",
  "law", "technology", "design", "film", "mathematics", "politics", "theology",
  "education", "art", "AI", "writing", "culture", "medicine", "architecture",
  "sociology", "religion", "business", "music", "linguistics", "environment",
] as const;

export type GeneralTopic = (typeof GENERAL_TOPICS)[number];

const GENERAL_SET = new Set<string>(GENERAL_TOPICS.map((t) => t.toLowerCase()));

/** True when `name` is one of the canonical general/coarse fields. */
export function isGeneralTopic(name: string): boolean {
  return GENERAL_SET.has(name.trim().toLowerCase());
}

/**
 * Returns the canonical general topic for `name` (lowercased) when it is a
 * valid general field, otherwise null. Used to reject free-form domains the LLM
 * might invent so generals stay confined to the onboarding-style set.
 */
export function normalizeGeneral(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  return GENERAL_SET.has(normalized) ? normalized : null;
}
