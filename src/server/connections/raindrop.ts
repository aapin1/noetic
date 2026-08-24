import { load } from "cheerio";
import { providerFetch } from "./http";
import { parseDate } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Raindrop: a public collection's RSS, no key. `bg.raindrop.io/rss/public/{id}`
 * redirects to the collection's own feed; a private or unknown id ends in a
 * bare 404. 50 newest bookmarks, no paging. Verified live 2026-08-23.
 *
 * The feed's `description` is the person's note when there is one and the
 * page's auto-excerpt otherwise, with nothing to tell them apart — so it is
 * never presented as their words. Each bookmark runs through the ordinary link
 * pipeline instead, which reads the page itself.
 */

export function parseCollectionId(input: string): string | null {
  const s = input.trim();
  if (/^\d{1,12}$/.test(s)) return s;
  const m = s.match(/(?:-|\/collection\/|\/my\/|\/rss\/public\/)(\d+)(?:\/feed)?\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export function parseRaindropFeed(xml: string): ProviderFeed {
  const $ = load(xml, { xmlMode: true });
  const label = $("channel > title").first().text().trim() || null;
  const items: ProviderItem[] = [];
  $("item").each((_, el) => {
    const item = $(el);
    const link = item.children("link").first().text().trim();
    if (!/^https?:\/\//i.test(link)) return;
    items.push({
      externalId: `rd-${link}`,
      title: item.children("title").first().text().trim() || link,
      url: link,
      words: "",
      occurredAt: parseDate(item.children("pubDate").first().text()) ?? new Date(),
      mode: "link",
    });
  });
  return { label, items, seen: items.length };
}

async function fetchFeed(id: string): Promise<string> {
  const res = await providerFetch(`https://bg.raindrop.io/rss/public/${encodeURIComponent(id)}`, { providerName: "raindrop" });
  if (res.status === 404) {
    throw new ProviderError("NOT_FOUND", "couldn't open that collection — in raindrop, make it public (share → public page) and paste the link again");
  }
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "raindrop isn't answering right now — try again in a bit", 503);
  return res.text();
}

export const raindrop: Provider = {
  key: "raindrop",
  async link(input) {
    const id = parseCollectionId(input);
    if (!id) throw new ProviderError("INVALID_INPUT", "paste the collection's link — the one that ends in a number");
    const feed = parseRaindropFeed(await fetchFeed(id));
    return { handle: id, label: feed.label };
  },
  async fetch({ handle }) {
    return parseRaindropFeed(await fetchFeed(handle));
  },
};
