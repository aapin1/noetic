/**
 * Display normalisation for text the server or the model wrote.
 *
 * Older generations arrive lowercase ("toward embodied cognition") or strung
 * with em dashes. New generations are prompted out of both, but cached rows
 * and old captures keep what they had, so the screen fixes them on the way in.
 */

/** First letter up. Leaves the rest alone, so "ai" stays "Ai" rather than "AI". */
export function sentenceCase(s: string | null | undefined): string {
  if (!s) return '';
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Capitalises the start of every sentence in a paragraph. */
export function sentenceCaseParagraph(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .trim()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/** Em and en dashes used as clause breaks become a comma; the rest stay. */
export function plainPunctuation(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/([a-zA-Z0-9])[—–]([a-zA-Z0-9])/g, '$1, $2')
    .replace(/\s*[—–]\s*$/g, '.');
}

/** The usual pipeline for a sentence or paragraph the model wrote. */
export function plainProse(s: string | null | undefined): string {
  return sentenceCaseParagraph(plainPunctuation(s));
}

/** For a short heading or label the model wrote. */
export function plainLabel(s: string | null | undefined): string {
  return sentenceCase(plainPunctuation(s));
}
