import { load } from "cheerio";
import { providerFetch } from "./http";
import { parseDate } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Instapaper: each section (unread, liked, archive, any folder) has a private
 * RSS URL with a secret in it — the URL *is* the credential, so it is stored
 * sealed like a token. Items are the original article links with an
 * auto-excerpt; no notes or highlights, so each article runs through the
 * ordinary link pipeline. Where to find it: instapaper.com on the web → open
 * the section → your email, top right → Download → RSS.
 */

const FEED = /^https?:\/\/(?:www\.)?instapaper\.com\/(?:(starred|archive)\/|folder\/(\d+)\/)?rss\/(\d+)\/([A-Za-z0-9_-]{8,})\/?$/i;

export function parseInstapaperFeed(input: string): { url: string; section: string } | null {
  const m = input.trim().match(FEED);
  if (!m) return null;
  const section = m[1] ? m[1] : m[2] ? `folder ${m[2]}` : "unread";
  return { url: `https://www.instapaper.com/${m[1] ? `${m[1]}/` : m[2] ? `folder/${m[2]}/` : ""}rss/${m[3]}/${m[4]}`, section };
}

export function parseInstapaperXml(xml: string): ProviderFeed {
  const $ = load(xml, { xmlMode: true });
  const label = $("channel > title").first().text().trim() || null;
  const items: ProviderItem[] = [];
  $("item").each((_, el) => {
    const item = $(el);
    const link = item.children("link").first().text().trim();
    if (!/^https?:\/\//i.test(link)) return;
    items.push({
      externalId: `ip-${link}`,
      title: item.children("title").first().text().trim() || link,
      url: link,
      words: "",
      occurredAt: parseDate(item.children("pubDate").first().text()) ?? new Date(),
      mode: "link",
    });
  });
  return { label, items, seen: items.length };
}

const NOT_FEED = "that link didn't open a feed — in instapaper on the web, pick download → rss and copy that link";

async function fetchFeed(url: string): Promise<string> {
  const res = await providerFetch(url, { providerName: "instapaper" });
  if (res.status === 404 || res.status === 403 || res.status === 401) throw new ProviderError("NOT_FOUND", NOT_FEED);
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "instapaper isn't answering right now — try again in a bit", 503);
  const text = await res.text();
  if (!/<rss|<feed/i.test(text.slice(0, 500))) throw new ProviderError("NOT_FOUND", NOT_FEED);
  return text;
}

export const instapaper: Provider = {
  key: "instapaper",
  async link(input) {
    const parsed = parseInstapaperFeed(input);
    if (!parsed) throw new ProviderError("INVALID_INPUT", NOT_FEED);
    const feed = parseInstapaperXml(await fetchFeed(parsed.url));
    return { handle: parsed.section, secret: parsed.url, label: feed.label };
  },
  async fetch({ secret }) {
    if (!secret) throw new ProviderError("BAD_TOKEN", "instapaper needs reconnecting — paste the rss link again");
    return parseInstapaperXml(await fetchFeed(secret));
  },
};
