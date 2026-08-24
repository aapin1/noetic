import { providerFetch } from "./http";
import { parseFeed, type FeedEntry } from "./rss";
import { clampText, hasWords, htmlToText } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Places people write. Each of these is a public feed of the person's own
 * posts — no token, no OAuth — and every entry is, by definition, their
 * words. Short posts become TEXT captures (mode "text"); long-form pieces
 * (Medium, Substack) are read as pages, since the body is the substance.
 *
 * Verified live 2026-08-23: Mastodon `{instance}/@{user}.rss`, Tumblr
 * `{blog}.tumblr.com/rss`, Medium `medium.com/feed/@{user}` (needs a UA),
 * Substack `{pub}/feed`, Bookwyrm `{instance}/user/{name}/rss-reviews`.
 */

const POST_MAX = 6000;
const TITLE_MAX = 80;

function snippet(text: string): string {
  const first = text.split(/\n/).map((l) => l.trim()).find(Boolean) ?? text;
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

/** A feed entry as the person's own post. */
function postItem(e: FeedEntry, idPrefix: string): ProviderItem | null {
  const words = clampText(htmlToText(e.html) || e.title, POST_MAX);
  if (!hasWords(words) || !e.link) return null;
  return {
    externalId: `${idPrefix}-${e.id}`,
    title: e.title && e.title !== words ? e.title : snippet(words),
    url: e.link,
    words,
    occurredAt: e.date ?? new Date(),
    mode: "text",
  };
}

/** A feed entry as an article the person published — read like a page. */
function articleItem(e: FeedEntry, idPrefix: string): ProviderItem | null {
  if (!e.link || !/^https?:\/\//i.test(e.link)) return null;
  return {
    externalId: `${idPrefix}-${e.id}`,
    title: e.title || e.link,
    url: e.link,
    words: "",
    occurredAt: e.date ?? new Date(),
    mode: "link",
  };
}

async function fetchXml(url: string, name: string, notFound: string): Promise<string> {
  const res = await providerFetch(url, { providerName: name, headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" } });
  if (res.status === 404 || res.status === 410) throw new ProviderError("NOT_FOUND", notFound);
  if (!res.ok) throw new ProviderError("UNAVAILABLE", `${name} isn't answering right now — try again in a bit`, 503);
  const text = await res.text();
  if (!/<(rss|feed)[\s>]/i.test(text.slice(0, 2000))) throw new ProviderError("NOT_FOUND", notFound);
  return text;
}

/** "@user@instance", "user@instance", "https://instance/@user" → parts. */
export function parseFediverseHandle(input: string): { user: string; instance: string } | null {
  const s = input.trim();
  const url = s.match(/^https?:\/\/([^/\s]+)\/@([A-Za-z0-9_.-]+)/i);
  if (url) return { instance: url[1].toLowerCase(), user: url[2] };
  const at = s.replace(/^@/, "").match(/^([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+\.[a-z]{2,})$/i);
  if (at) return { user: at[1], instance: at[2].toLowerCase() };
  return null;
}

export const mastodon: Provider = {
  key: "mastodon",
  async link(input) {
    const h = parseFediverseHandle(input);
    if (!h) throw new ProviderError("INVALID_INPUT", "that doesn't look like a mastodon handle — try @you@instance.social");
    const feed = parseFeed(await fetchXml(`https://${h.instance}/@${h.user}.rss`, "mastodon", `couldn't find @${h.user} on ${h.instance} — check the spelling`));
    return { handle: `${h.user}@${h.instance}`, label: feed.title };
  },
  async fetch({ handle }) {
    const [user, instance] = handle.split("@");
    const feed = parseFeed(await fetchXml(`https://${instance}/@${user}.rss`, "mastodon", `@${user} is no longer on ${instance}`));
    const items = feed.entries.map((e) => postItem(e, "mast")).filter((i): i is ProviderItem => !!i);
    return { label: feed.title, items, seen: feed.entries.length };
  },
};

/** "@handle.bsky.social", "handle.bsky.social", "https://bsky.app/profile/handle" → handle. */
export function parseBlueskyHandle(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/bsky\.app\/profile\/([^/?#\s]+)/i);
  if (m) s = m[1];
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase();
  if (/^[a-z0-9-]{3,}$/i.test(s)) return `${s.toLowerCase()}.bsky.social`;
  return null;
}

type BskyPost = { post: { uri: string; record: { text: string; createdAt: string }; embed?: { external?: { uri: string } } } };

export const bluesky: Provider = {
  key: "bluesky",
  async link(input) {
    const handle = parseBlueskyHandle(input);
    if (!handle) throw new ProviderError("INVALID_INPUT", "that doesn't look like a bluesky handle — try you.bsky.social");
    const res = await providerFetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`, { providerName: "bluesky" });
    if (res.status === 400 || res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find ${handle} on bluesky — check the spelling`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "bluesky isn't answering right now — try again in a bit", 503);
    const profile = (await res.json()) as { handle: string; displayName?: string };
    return { handle: profile.handle, label: profile.displayName || profile.handle };
  },
  async fetch({ handle }) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_no_replies`;
    const res = await providerFetch(url, { providerName: "bluesky" });
    if (res.status === 400 || res.status === 404) throw new ProviderError("NOT_FOUND", `${handle} is no longer on bluesky`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "bluesky isn't answering right now — try again in a bit", 503);
    const data = (await res.json()) as { feed: BskyPost[] };
    const items: ProviderItem[] = [];
    for (const { post } of data.feed) {
      const words = clampText(post.record.text?.trim() ?? "", POST_MAX);
      if (!hasWords(words)) continue;
      const rkey = post.uri.split("/").pop() ?? post.uri;
      items.push({
        externalId: `bsky-${rkey}`,
        title: snippet(words),
        url: `https://bsky.app/profile/${handle}/post/${rkey}`,
        words,
        occurredAt: new Date(post.record.createdAt),
        mode: "text",
      });
    }
    return { label: null, items, seen: data.feed.length };
  },
};

export function parseTumblrBlog(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.tumblr\.com/i) ?? s.match(/tumblr\.com\/([a-z0-9-]+)/i);
  if (m) s = m[1];
  return /^[a-z0-9-]{1,32}$/i.test(s) ? s.toLowerCase() : null;
}

export const tumblr: Provider = {
  key: "tumblr",
  async link(input) {
    const blog = parseTumblrBlog(input);
    if (!blog) throw new ProviderError("INVALID_INPUT", "that doesn't look like a tumblr — try the blog name");
    const feed = parseFeed(await fetchXml(`https://${blog}.tumblr.com/rss`, "tumblr", `couldn't find a tumblr called "${blog}" — check the spelling`));
    return { handle: blog, label: feed.title };
  },
  async fetch({ handle }) {
    const feed = parseFeed(await fetchXml(`https://${handle}.tumblr.com/rss`, "tumblr", "that tumblr is gone"));
    const items = feed.entries.map((e) => postItem(e, "tmblr")).filter((i): i is ProviderItem => !!i);
    return { label: feed.title, items, seen: feed.entries.length };
  },
};

export function parseMediumUser(input: string): string | null {
  let s = input.trim();
  const m = s.match(/medium\.com\/@([A-Za-z0-9_.-]+)/i) ?? s.match(/medium\.com\/feed\/@([A-Za-z0-9_.-]+)/i);
  if (m) s = m[1];
  s = s.replace(/^@/, "");
  return /^[A-Za-z0-9_.-]{1,64}$/.test(s) ? s : null;
}

export const medium: Provider = {
  key: "medium",
  async link(input) {
    const user = parseMediumUser(input);
    if (!user) throw new ProviderError("INVALID_INPUT", "that doesn't look like a medium username — try @you");
    const feed = parseFeed(await fetchXml(`https://medium.com/feed/@${user}`, "medium", `couldn't find @${user} on medium — check the spelling`));
    return { handle: user, label: feed.title?.replace(/^Stories by\s+/i, "").replace(/\s+on Medium$/i, "") ?? null };
  },
  async fetch({ handle }) {
    const feed = parseFeed(await fetchXml(`https://medium.com/feed/@${handle}`, "medium", "that medium account is gone"));
    const items = feed.entries.map((e) => articleItem(e, "med")).filter((i): i is ProviderItem => !!i);
    return { label: null, items, seen: feed.entries.length };
  },
};

export function parseSubstackPub(input: string): string | null {
  let s = input.trim().toLowerCase();
  const m = s.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.substack\.com/) ;
  if (m) return `${m[1]}.substack.com`;
  const custom = s.match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:\/.*)?$/);
  if (custom) return custom[1];
  if (/^[a-z0-9-]{2,}$/.test(s)) return `${s}.substack.com`;
  return null;
}

/** A writer's own publication. Readers' likes and saves have no feed. */
export const substack: Provider = {
  key: "substack",
  async link(input) {
    const host = parseSubstackPub(input);
    if (!host) throw new ProviderError("INVALID_INPUT", "paste your publication's link — like you.substack.com");
    const feed = parseFeed(await fetchXml(`https://${host}/feed`, "substack", `couldn't find a publication at ${host}`));
    return { handle: host, label: feed.title };
  },
  async fetch({ handle }) {
    const feed = parseFeed(await fetchXml(`https://${handle}/feed`, "substack", "that publication is gone"));
    const items = feed.entries.map((e) => articleItem(e, "sub")).filter((i): i is ProviderItem => !!i);
    return { label: feed.title, items, seen: feed.entries.length };
  },
};

/** "@name@bookwyrm.social", "https://bookwyrm.social/user/name" → parts. */
export function parseBookwyrmHandle(input: string): { user: string; instance: string } | null {
  const s = input.trim();
  const url = s.match(/^https?:\/\/([^/\s]+)\/user\/([A-Za-z0-9_.-]+)/i);
  if (url) return { instance: url[1].toLowerCase(), user: url[2] };
  return parseFediverseHandle(s);
}

export const bookwyrm: Provider = {
  key: "bookwyrm",
  async link(input) {
    const h = parseBookwyrmHandle(input);
    if (!h) throw new ProviderError("INVALID_INPUT", "that doesn't look like a bookwyrm account — try @you@bookwyrm.social");
    const feed = parseFeed(await fetchXml(`https://${h.instance}/user/${h.user}/rss-reviews`, "bookwyrm", `couldn't find ${h.user} on ${h.instance} — check the spelling`));
    return { handle: `${h.user}@${h.instance}`, label: feed.title };
  },
  async fetch({ handle }) {
    const [user, instance] = handle.split("@");
    const feed = parseFeed(await fetchXml(`https://${instance}/user/${user}/rss-reviews`, "bookwyrm", `${user} is no longer on ${instance}`));
    const items: ProviderItem[] = [];
    for (const e of feed.entries) {
      const words = clampText(htmlToText(e.html), POST_MAX);
      if (!hasWords(words) || !e.link) continue;
      items.push({ externalId: `bw-${e.id}`, title: e.title || snippet(words), url: e.link, words, occurredAt: e.date ?? new Date() });
    }
    return { label: feed.title, items, seen: feed.entries.length };
  },
};

type HnHit = { objectID: string; comment_text?: string | null; story_text?: string | null; title?: string | null; story_title?: string | null; story_url?: string | null; url?: string | null; created_at: string; story_id?: number | null };

export const hackernews: Provider = {
  key: "hackernews",
  async link(input) {
    const user = input.trim().replace(/^@/, "").replace(/.*news\.ycombinator\.com\/user\?id=/i, "");
    if (!/^[A-Za-z0-9_-]{2,15}$/.test(user)) throw new ProviderError("INVALID_INPUT", "that doesn't look like a hacker news username");
    const res = await providerFetch(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(user)}.json`, { providerName: "hacker news" });
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "hacker news isn't answering right now — try again in a bit", 503);
    const profile = (await res.json()) as { id: string } | null;
    if (!profile) throw new ProviderError("NOT_FOUND", `couldn't find a hacker news user called "${user}" — check the spelling`);
    return { handle: profile.id, label: profile.id };
  },
  async fetch({ handle }) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=author_${encodeURIComponent(handle)},(comment,story)&hitsPerPage=200`;
    const res = await providerFetch(url, { providerName: "hacker news" });
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "hacker news isn't answering right now — try again in a bit", 503);
    const data = (await res.json()) as { hits: HnHit[] };
    const items: ProviderItem[] = [];
    for (const h of data.hits) {
      const words = clampText(htmlToText(h.comment_text || h.story_text || ""), POST_MAX);
      if (!hasWords(words)) continue;
      const about = h.story_title || h.title;
      items.push({
        externalId: `hn-${h.objectID}`,
        title: about ? `re: ${about}` : snippet(words),
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        words,
        occurredAt: new Date(h.created_at),
        mode: "text",
      });
    }
    return { label: null, items, seen: data.hits.length };
  },
};

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export function parseRedditUser(input: string): string | null {
  let s = input.trim().replace(/^(u\/|@)/i, "");
  const m = s.match(/reddit\.com\/(?:u|user)\/([A-Za-z0-9_-]+)/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9_-]{3,20}$/.test(s) ? s : null;
}

/** Reddit gates its feeds by user agent and throttles datacenter IPs; this works from here today and may not tomorrow. */
export const reddit: Provider = {
  key: "reddit",
  async link(input) {
    const user = parseRedditUser(input);
    if (!user) throw new ProviderError("INVALID_INPUT", "that doesn't look like a reddit username — try u/you");
    const res = await providerFetch(`https://www.reddit.com/user/${user}/comments.rss`, { providerName: "reddit", headers: { "user-agent": CHROME_UA } });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find u/${user} — check the spelling`);
    if (res.status === 429 || res.status === 403) throw new ProviderError("UNAVAILABLE", "reddit is turning us away right now — try again later", 503);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "reddit isn't answering right now — try again in a bit", 503);
    const feed = parseFeed(await res.text());
    return { handle: user, label: feed.title?.replace(/^comments by\s+/i, "") ?? user };
  },
  async fetch({ handle }) {
    const res = await providerFetch(`https://www.reddit.com/user/${handle}/comments.rss`, { providerName: "reddit", headers: { "user-agent": CHROME_UA } });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `u/${handle} is gone`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "reddit is turning us away right now — open mneme to refresh it from your phone", 503);
    return reddit.parse!(await res.text());
  },
  deviceFeed: (handle) => ({ url: `https://www.reddit.com/user/${handle}/comments.rss`, headers: { "user-agent": CHROME_UA } }),
  parse: (text) => {
    if (!/<(rss|feed)[\s>]/i.test(text.slice(0, 3000))) {
      throw new ProviderError("UNAVAILABLE", "reddit is turning us away right now — try again in a while", 503);
    }
    const feed = parseFeed(text);
    const items = feed.entries.map((e) => postItem(e, "rdt")).filter((i): i is ProviderItem => !!i);
    return { label: null, items, seen: feed.entries.length };
  },
};
