import { load } from "cheerio";
import { providerFetch } from "./http";
import { clampText, hasWords, htmlToText, parseDate, starsFromRating } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Goodreads: `goodreads.com/review/list_rss/{id}?shelf=read` is public, needs
 * no key, and pages 100 at a time (`?page=N`, disjoint, newest first). A
 * private shelf answers 401, an unknown id 404. `user_review` is HTML;
 * `user_rating` 0 means unrated. Verified live 2026-08-23.
 *
 * People know their username or profile URL, not their numeric id, so
 * `goodreads.com/{vanity}` and `/user/show/{id}-slug` are resolved by
 * following the 301 Goodreads answers with.
 */

const REVIEW_MAX = 6000;
const BLURB_MAX = 1200;
/** Pages fetched per sync. 300 most recent reads; a second sync day gets no more — the feed is newest-first and the ledger skips what it has. */
const MAX_PAGES = 3;

function shelfUrl(id: string, page: number): string {
  return `https://www.goodreads.com/review/list_rss/${id}?shelf=read&page=${page}`;
}

/**
 * A numeric id, a profile URL, or a vanity name. Anything that isn't already
 * a number needs one network hop to resolve; `resolve` does that.
 */
export function parseGoodreadsInput(input: string): { id: string } | { vanity: string } | null {
  const s = input.trim().replace(/^@/, "");
  if (/^\d{1,12}$/.test(s)) return { id: s };
  const show = s.match(/goodreads\.com\/user\/show\/(\d+)/i);
  if (show) return { id: show[1] };
  const path = s.match(/goodreads\.com\/([^/?#\s]+)/i);
  const vanity = (path ? path[1] : s).replace(/\/.*$/, "");
  if (!/^[a-z0-9_.-]{1,60}$/i.test(vanity)) return null;
  if (/^(user|review|book|author|list|search|shelf)$/i.test(vanity)) return null;
  return { vanity };
}

async function resolveId(vanity: string): Promise<string> {
  const res = await providerFetch(`https://www.goodreads.com/${encodeURIComponent(vanity)}`, {
    providerName: "goodreads",
    redirect: "manual",
    method: "HEAD",
  });
  const location = res.headers.get("location") ?? "";
  const m = location.match(/\/user\/show\/(\d+)/);
  if (m) return m[1];
  if (res.status === 404 || res.status === 200) {
    throw new ProviderError("NOT_FOUND", `couldn't find a goodreads profile called "${vanity}" — try your profile link instead`);
  }
  throw new ProviderError("UNAVAILABLE", "goodreads isn't answering right now — try again in a bit", 503);
}

export function parseGoodreadsFeed(xml: string): ProviderFeed {
  const $ = load(xml, { xmlMode: true });
  const channelTitle = $("channel > title").first().text().trim();
  const label = channelTitle.replace(/\s*'s bookshelf:.*$/i, "").trim() || null;

  const items: ProviderItem[] = [];
  let seen = 0;

  $("item").each((_, el) => {
    const item = $(el);
    const field = (name: string) => item.children(name).first().text().trim();
    seen += 1;

    const words = clampText(htmlToText(field("user_review")), REVIEW_MAX);
    if (!hasWords(words)) return;

    const link = field("link").replace(/[?&]utm_[^&]*/g, "").replace(/\?$/, "");
    const reviewId = link.match(/\/review\/show\/(\d+)/)?.[1] ?? field("book_id");
    const published = field("book_published");
    const title = field("title");

    items.push({
      externalId: `goodreads-review-${reviewId}`,
      title: published ? `${title} (${published})` : title,
      url: link,
      words,
      description: clampText(htmlToText(field("book_description")), BLURB_MAX) || undefined,
      author: field("author_name") || undefined,
      imageUrl: field("book_large_image_url") || field("book_image_url") || undefined,
      rating: starsFromRating(field("user_rating")) ?? undefined,
      occurredAt:
        parseDate(field("user_read_at")) ?? parseDate(field("user_date_added")) ?? parseDate(field("pubDate")) ?? new Date(),
    });
  });

  return { label, items, seen };
}

async function fetchPage(id: string, page: number): Promise<string> {
  const res = await providerFetch(shelfUrl(id, page), { providerName: "goodreads" });
  if (res.status === 401) {
    throw new ProviderError(
      "PRIVATE",
      "that goodreads shelf is private — make your \"read\" shelf public in goodreads settings, then try again",
    );
  }
  if (res.status === 404) {
    throw new ProviderError("NOT_FOUND", "couldn't find that goodreads account — try your profile link");
  }
  if (!res.ok) {
    throw new ProviderError("UNAVAILABLE", "goodreads isn't answering right now — try again in a bit", 503);
  }
  return res.text();
}

export const goodreads: Provider = {
  key: "goodreads",
  async link(input) {
    const parsed = parseGoodreadsInput(input);
    if (!parsed) {
      throw new ProviderError("INVALID_INPUT", "that doesn't look like a goodreads profile — paste your profile link or username");
    }
    const id = "id" in parsed ? parsed.id : await resolveId(parsed.vanity);
    const feed = parseGoodreadsFeed(await fetchPage(id, 1));
    return { handle: id, label: feed.label };
  },
  async fetch({ handle }) {
    const first = parseGoodreadsFeed(await fetchPage(handle, 1));
    const items = [...first.items];
    let seen = first.seen;
    let pageSeen = first.seen;
    for (let page = 2; page <= MAX_PAGES && pageSeen >= 100; page += 1) {
      const next = parseGoodreadsFeed(await fetchPage(handle, page));
      items.push(...next.items);
      seen += next.seen;
      pageSeen = next.seen;
    }
    return { label: first.label, items, seen };
  },
};
