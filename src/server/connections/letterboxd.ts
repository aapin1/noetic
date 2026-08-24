import { load } from "cheerio";
import { providerFetch } from "./http";
import { clampText, hasWords, htmlToText, parseDate, starsFromRating } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Letterboxd: `letterboxd.com/{user}/rss/` is public, needs no key or UA, and
 * carries the last 50 diary entries (plus 50 lists, which we ignore). The
 * guid prefix says whether an entry has a review: `letterboxd-review-…` does,
 * `letterboxd-watch-…` is a bare log. Verified live 2026-08-23.
 *
 * Profile and film pages 403 from datacenter IPs, so the feed is the whole
 * source of truth — nothing here scrapes.
 */

const HANDLE = /^[a-z0-9_]{2,15}$/i;
const REVIEW_MAX = 6000;

/** "dave", "@dave", "letterboxd.com/dave/", "https://letterboxd.com/dave/films/" → "dave". */
export function parseLetterboxdHandle(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/letterboxd\.com\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/\/.*$/, "");
  return HANDLE.test(s) ? s.toLowerCase() : null;
}

function feedUrl(handle: string): string {
  return `https://letterboxd.com/${encodeURIComponent(handle)}/rss/`;
}

export function parseLetterboxdFeed(xml: string): ProviderFeed {
  const $ = load(xml, { xmlMode: true });
  const channelTitle = $("channel > title").first().text().trim();
  const label = channelTitle.replace(/^Letterboxd\s*-\s*/i, "").trim() || null;

  const items: ProviderItem[] = [];
  let seen = 0;

  $("item").each((_, el) => {
    const item = $(el);
    const field = (name: string) => item.children(name.replace(":", "\\:")).first().text().trim();

    const filmTitle = field("letterboxd:filmTitle");
    if (!filmTitle) return; // a list, not a diary entry
    seen += 1;

    const guid = field("guid");
    if (!guid.startsWith("letterboxd-review-")) return; // bare watch: no words

    const html = field("description");
    const $d = load(`<div>${html}</div>`);
    const poster = $d("img").first().attr("src");
    $d("p:has(img)").remove();
    $d("p:has(em)").filter((_, p) => /contain spoilers/i.test($d(p).text())).remove();
    const words = clampText(htmlToText($d.root().html() ?? ""), REVIEW_MAX);
    if (!hasWords(words)) return;

    const year = field("letterboxd:filmYear");
    const rating = starsFromRating(field("letterboxd:memberRating"));
    const rewatch = field("letterboxd:rewatch") === "Yes";
    const occurredAt =
      parseDate(field("letterboxd:watchedDate")) ?? parseDate(field("pubDate")) ?? new Date();

    items.push({
      externalId: guid,
      title: year ? `${filmTitle} (${year})` : filmTitle,
      url: field("link"),
      words,
      imageUrl: poster || undefined,
      rating: [rating, rewatch ? "rewatch" : null].filter(Boolean).join(" · ") || undefined,
      occurredAt,
    });
  });

  return { label, items, seen };
}

async function fetchFeed(handle: string): Promise<string> {
  const res = await providerFetch(feedUrl(handle), { providerName: "letterboxd" });
  if (res.status === 404) {
    throw new ProviderError("NOT_FOUND", `couldn't find a letterboxd called "${handle}" — check the spelling`);
  }
  if (!res.ok) {
    throw new ProviderError("UNAVAILABLE", "letterboxd isn't answering right now — try again in a bit", 503);
  }
  return res.text();
}

export const letterboxd: Provider = {
  key: "letterboxd",
  async link(input) {
    const handle = parseLetterboxdHandle(input);
    if (!handle) {
      throw new ProviderError("INVALID_INPUT", "that doesn't look like a letterboxd username — try just the name, like \"dave\"");
    }
    const feed = parseLetterboxdFeed(await fetchFeed(handle));
    return { handle, label: feed.label };
  },
  async fetch({ handle }) {
    return parseLetterboxdFeed(await fetchFeed(handle));
  },
};
