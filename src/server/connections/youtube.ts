import { load } from "cheerio";
import { providerFetch } from "./http";
import { parseDate } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * YouTube: a public playlist's Atom feed, no key. Liked videos and watch
 * history are OAuth-only (and history has no API at all), so the one thing a
 * person can hand over is a playlist they keep — "Watch later" made public,
 * or any list they curate. The feed holds the 15 newest videos. Each one runs
 * through the ordinary link pipeline (captions → transcript).
 */

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

export function parsePlaylistId(input: string): string | null {
  const s = input.trim();
  const fromUrl = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  if (/^(https?:)?\/\//i.test(s) || s.includes("/")) return null;
  return PLAYLIST_ID.test(s) ? s : null;
}

function feedUrl(id: string): string {
  return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(id)}`;
}

export function parsePlaylistFeed(xml: string): ProviderFeed {
  const $ = load(xml, { xmlMode: true });
  const label = $("feed > title").first().text().trim() || null;
  const items: ProviderItem[] = [];
  $("entry").each((_, el) => {
    const entry = $(el);
    const videoId = entry.children("yt\\:videoId").first().text().trim();
    if (!videoId) return;
    items.push({
      externalId: `yt-${videoId}`,
      title: entry.children("title").first().text().trim() || "Untitled video",
      url: `https://www.youtube.com/watch?v=${videoId}`,
      words: "",
      occurredAt: parseDate(entry.children("published").first().text()) ?? new Date(),
      mode: "link",
    });
  });
  return { label, items, seen: items.length };
}

async function fetchFeed(id: string): Promise<string> {
  const res = await providerFetch(feedUrl(id), { providerName: "youtube" });
  if (res.status === 404 || res.status === 403) {
    throw new ProviderError("NOT_FOUND", "couldn't open that playlist — it needs to be public or unlisted, not private");
  }
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "youtube isn't answering right now — try again in a bit", 503);
  return res.text();
}

export const youtube: Provider = {
  key: "youtube",
  async link(input) {
    const id = parsePlaylistId(input);
    if (!id) throw new ProviderError("INVALID_INPUT", "paste a playlist link — the one with ?list= in it");
    const feed = parsePlaylistFeed(await fetchFeed(id));
    return { handle: id, label: feed.label };
  },
  async fetch({ handle }) {
    return parsePlaylistFeed(await fetchFeed(handle));
  },
};
