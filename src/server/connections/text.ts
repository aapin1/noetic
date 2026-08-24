import { load } from "cheerio";

/** HTML (review bodies, book blurbs) → plain paragraphs. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const $ = load(`<div>${html}</div>`);
  $("img, script, style").remove();
  // Keep paragraph breaks: block-ish tags become newlines before we flatten.
  $("br").replaceWith("\n");
  $("p, div, li, blockquote, h1, h2, h3, h4").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return $.root()
    .text()
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Does this read as something the person actually wrote? Two alphabetic
 * words is the bar: "🔥" and "5/5" are reactions, not thoughts.
 */
export function hasWords(text: string): boolean {
  const words = text.match(/\p{L}{2,}/gu);
  return !!words && words.length >= 2;
}

/** "4.5" → "★★★★½"; "0" / "" → null. */
export function starsFromRating(value: string | number | null | undefined): string | null {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n) || n <= 0) return null;
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return "★".repeat(full) + (half ? "½" : "");
}

/** Hard cap on text we hand to the pipeline, cut at a sentence/paragraph. */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf(". "));
  return (cut > max * 0.5 ? head.slice(0, cut + 1) : head).trimEnd() + "…";
}

export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}
