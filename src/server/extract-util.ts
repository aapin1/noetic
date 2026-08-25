/** Helpers shared by the extraction ladders (metadata.ts, social.ts, supadata.ts). */

/** Article/transcript body budget. Long content is fitted via
 * condenseToBudget rather than truncated at this many chars. */
export const BODY_TEXT_LIMIT = 12000;

/**
 * Fits long text into the body budget by sampling head, middle, and tail
 * instead of blind truncation. A 2-hour transcript cut at the old cap kept
 * only the first ~8 minutes, so embeddings, topics, and insights never saw
 * the argument's development or conclusion. Segment edges land on word
 * boundaries, and elisions are marked so the LLM knows material was skipped.
 */
export function condenseToBudget(text: string, limit = BODY_TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  const sep = "\n[…]\n";
  const budget = limit - 2 * sep.length;
  const headLen = Math.floor(budget * 0.45);
  const midLen = Math.floor(budget * 0.3);
  const tailLen = budget - headLen - midLen;
  const head = text.slice(0, headLen).replace(/\S+$/, "").trimEnd();
  const midStart = Math.floor(text.length / 2 - midLen / 2);
  const middle = text
    .slice(midStart, midStart + midLen)
    .replace(/^\S+/, "")
    .replace(/\S+$/, "")
    .trim();
  const tail = text
    .slice(text.length - tailLen)
    .replace(/^\S+/, "")
    .trimStart();
  return [head, middle, tail].join(sep);
}

/** fetch with a hard timeout so a hung host can't stall the capture pipeline. */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// A real browser UA + consent cookie for sites that serve stripped pages to
// non-browser agents (Reddit's JSON API, bot-guarded article sites).
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Mobile Safari UA. TikTok and Instagram serve their lightweight "reflow" /
 * embed pages — with the item JSON inlined — to phones, and a login shell
 * to desktop browsers without cookies. */
export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
