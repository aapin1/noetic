import { providerFetch } from "./http";
import { clampText, hasWords, htmlToText, parseDate } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Places people keep things with a note attached: Pinboard, Are.na, Zotero,
 * GitHub stars. Entries with the person's note are words; bare keeps run
 * through the link pipeline. All public, no OAuth. Verified live 2026-08-23:
 * `feeds.pinboard.in/json/u:{user}/`, `api.are.na/v3/users/{id}/contents`,
 * `api.zotero.org/users/{id}/items`, `api.github.com/users/{u}/starred`.
 */

const NOTE_MAX = 4000;

// ---------------------------------------------------------------- pinboard

type PinboardPost = { u: string; d: string; n: string; dt: string; t: string[] };

export function parsePinboardInput(input: string): { user: string } | { token: string } | null {
  const s = input.trim().replace(/^@/, "");
  if (/^[A-Za-z0-9_-]+:[A-Za-z0-9]{16,}$/.test(s)) return { token: s };
  const m = s.match(/pinboard\.in\/u:([A-Za-z0-9_-]+)/i);
  const user = (m ? m[1] : s).replace(/\/.*$/, "");
  return /^[A-Za-z0-9_-]{1,40}$/.test(user) ? { user } : null;
}

function pinboardItems(posts: PinboardPost[]): ProviderItem[] {
  return posts
    .filter((p) => /^https?:\/\//i.test(p.u))
    .map((p) => {
      const note = clampText((p.n ?? "").trim(), NOTE_MAX);
      const words = hasWords(note) ? note : "";
      return {
        externalId: `pin-${p.u}`,
        title: p.d?.trim() || p.u,
        url: p.u,
        words,
        occurredAt: parseDate(p.dt) ?? new Date(),
        mode: "link" as const,
      };
    });
}

/** Username → public bookmarks; "user:TOKEN" (pinboard.in/settings/password) → everything. */
export const pinboard: Provider = {
  key: "pinboard",
  async link(input) {
    const parsed = parsePinboardInput(input);
    if (!parsed) throw new ProviderError("INVALID_INPUT", "try your pinboard username, or the api token from pinboard.in/settings/password for private bookmarks too");
    if ("token" in parsed) {
      const res = await providerFetch(`https://api.pinboard.in/v1/user/api_token/?auth_token=${encodeURIComponent(parsed.token)}&format=json`, { providerName: "pinboard" });
      if (res.status === 401) throw new ProviderError("BAD_TOKEN", "pinboard didn't accept that token — copy it again from pinboard.in/settings/password");
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "pinboard isn't answering right now — try again in a bit", 503);
      return { handle: parsed.token.split(":")[0], secret: parsed.token, label: parsed.token.split(":")[0] };
    }
    const res = await providerFetch(`https://feeds.pinboard.in/json/u:${encodeURIComponent(parsed.user)}/?count=1`, { providerName: "pinboard" });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find a pinboard called "${parsed.user}" — check the spelling`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "pinboard isn't answering right now — try again in a bit", 503);
    return { handle: parsed.user, label: parsed.user };
  },
  async fetch({ handle, secret }) {
    const url = secret
      ? `https://api.pinboard.in/v1/posts/all?auth_token=${encodeURIComponent(secret)}&format=json&results=400`
      : `https://feeds.pinboard.in/json/u:${encodeURIComponent(handle)}/?count=400`;
    const res = await providerFetch(url, { providerName: "pinboard" });
    if (res.status === 401) throw new ProviderError("BAD_TOKEN", "pinboard needs reconnecting — paste a fresh token from pinboard.in/settings/password");
    if (res.status === 404) throw new ProviderError("NOT_FOUND", "that pinboard account is gone");
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "pinboard isn't answering right now — try again in a bit", 503);
    const posts = (await res.json()) as PinboardPost[];
    return { label: null, items: pinboardItems(posts), seen: posts.length };
  },
};

// ------------------------------------------------------------------ are.na

type ArenaText = string | { markdown?: string | null; html?: string | null } | null | undefined;
type ArenaBlock = {
  id: number;
  type: string;
  title: string | null;
  /** v3 returns prose fields as { markdown, html }; older payloads as strings. */
  description: ArenaText;
  created_at: string;
  content?: ArenaText;
  source?: { url?: string | null } | null;
  slug?: string | null;
};

function arenaText(value: ArenaText): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.markdown ?? htmlToText(value.html);
}

export function parseArenaSlug(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/are\.na\/([A-Za-z0-9_-]+)/i);
  if (m) s = m[1];
  s = s.replace(/\/.*$/, "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s.toLowerCase() : null;
}

export function arenaItems(blocks: ArenaBlock[]): ProviderItem[] {
  const items: ProviderItem[] = [];
  for (const b of blocks) {
    const date = parseDate(b.created_at) ?? new Date();
    if (b.type === "Text") {
      const words = clampText(arenaText(b.content).trim(), NOTE_MAX);
      if (!hasWords(words)) continue;
      items.push({ externalId: `arena-${b.id}`, title: b.title?.trim() || words.split("\n")[0].slice(0, 80), url: `https://www.are.na/block/${b.id}`, words, occurredAt: date, mode: "text" });
    } else if (b.type === "Link" && b.source?.url && /^https?:\/\//i.test(b.source.url)) {
      const note = clampText(arenaText(b.description).trim(), NOTE_MAX);
      items.push({ externalId: `arena-${b.id}`, title: b.title?.trim() || b.source.url, url: b.source.url, words: hasWords(note) ? note : "", occurredAt: date, mode: "link" });
    }
  }
  return items;
}

export const arena: Provider = {
  key: "arena",
  async link(input) {
    const slug = parseArenaSlug(input);
    if (!slug) throw new ProviderError("INVALID_INPUT", "that doesn't look like an are.na username");
    const res = await providerFetch(`https://api.are.na/v3/users/${encodeURIComponent(slug)}`, { providerName: "are.na" });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find "${slug}" on are.na — check the spelling`);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "are.na isn't answering right now — try again in a bit", 503);
    const user = (await res.json()) as { id: number; slug: string; name?: string | null };
    return { handle: String(user.id), label: user.name || user.slug };
  },
  async fetch({ handle }) {
    const blocks: ArenaBlock[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const res = await providerFetch(`https://api.are.na/v3/users/${encodeURIComponent(handle)}/contents?per=100&page=${page}`, { providerName: "are.na" });
      if (res.status === 404) throw new ProviderError("NOT_FOUND", "that are.na account is gone");
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "are.na isn't answering right now — try again in a bit", 503);
      const data = (await res.json()) as { data?: ArenaBlock[]; contents?: ArenaBlock[] };
      const rows = data.data ?? data.contents ?? [];
      blocks.push(...rows);
      if (rows.length < 100) break;
    }
    return { label: null, items: arenaItems(blocks), seen: blocks.length };
  },
};

// ------------------------------------------------------------------ zotero

type ZoteroItem = {
  key: string;
  data: {
    itemType: string;
    title?: string;
    note?: string;
    url?: string;
    DOI?: string;
    abstractNote?: string;
    parentItem?: string;
    annotationText?: string;
    annotationComment?: string;
    dateAdded?: string;
    dateModified?: string;
    creators?: { firstName?: string; lastName?: string; name?: string }[];
  };
};

export function parseZoteroInput(input: string): { userId: string } | { apiKey: string } | null {
  const s = input.trim();
  if (/^\d{1,12}$/.test(s)) return { userId: s };
  const m = s.match(/zotero\.org\/(?:users\/)?(\d+)/i);
  if (m) return { userId: m[1] };
  if (/^[A-Za-z0-9]{24}$/.test(s)) return { apiKey: s };
  return null;
}

function zoteroHeaders(secret: string | null): Record<string, string> {
  return secret ? { "zotero-api-key": secret } : {};
}

/** Notes and PDF annotations carry the person's words; papers themselves are kept pages. */
export function zoteroItems(rows: ZoteroItem[]): ProviderItem[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const items: ProviderItem[] = [];
  for (const r of rows) {
    const d = r.data;
    const date = parseDate(d.dateModified ?? d.dateAdded) ?? new Date();
    if (d.itemType === "note" || d.itemType === "annotation") {
      const words = clampText(
        d.itemType === "note" ? htmlToText(d.note) : [d.annotationText, d.annotationComment].filter(Boolean).join("\n\n"),
        NOTE_MAX,
      );
      if (!hasWords(words)) continue;
      let parent = d.parentItem ? byKey.get(d.parentItem) : undefined;
      // An annotation's parent is the PDF attachment; the paper is one up.
      if (parent?.data.itemType === "attachment" && parent.data.parentItem) parent = byKey.get(parent.data.parentItem);
      const title = parent?.data.title?.trim() || words.split("\n")[0].slice(0, 80);
      const url = parent?.data.url || (parent?.data.DOI ? `https://doi.org/${parent.data.DOI}` : `https://www.zotero.org/items/${r.key}`);
      items.push({ externalId: `zot-${r.key}`, title, url, words, occurredAt: date, mode: d.itemType === "annotation" ? "words" : "text", quote: d.itemType === "annotation" ? d.annotationText : undefined });
    }
  }
  return items;
}

export const zotero: Provider = {
  key: "zotero",
  async link(input) {
    const parsed = parseZoteroInput(input);
    if (!parsed) throw new ProviderError("INVALID_INPUT", "try your zotero user id (zotero.org/settings/keys shows it), or an api key from the same page");
    if ("apiKey" in parsed) {
      const res = await providerFetch(`https://api.zotero.org/keys/${encodeURIComponent(parsed.apiKey)}`, { providerName: "zotero" });
      if (res.status === 403 || res.status === 404) throw new ProviderError("BAD_TOKEN", "zotero didn't accept that key — make a new one at zotero.org/settings/keys");
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "zotero isn't answering right now — try again in a bit", 503);
      const key = (await res.json()) as { userID: number; username?: string };
      return { handle: String(key.userID), secret: parsed.apiKey, label: key.username ?? null };
    }
    const res = await providerFetch(`https://api.zotero.org/users/${parsed.userId}/items?limit=1&format=json`, { providerName: "zotero" });
    if (res.status === 403) throw new ProviderError("PRIVATE", "that zotero library is private — paste an api key from zotero.org/settings/keys instead");
    if (res.status === 404) throw new ProviderError("NOT_FOUND", "couldn't find that zotero user — check the id");
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "zotero isn't answering right now — try again in a bit", 503);
    return { handle: parsed.userId, label: null };
  },
  async fetch({ handle, secret }) {
    const rows: ZoteroItem[] = [];
    for (let start = 0; start < 300; start += 100) {
      const res = await providerFetch(`https://api.zotero.org/users/${handle}/items?limit=100&start=${start}&format=json&sort=dateModified`, { providerName: "zotero", headers: zoteroHeaders(secret) });
      if (res.status === 403) throw new ProviderError("PRIVATE", "that zotero library went private — paste an api key from zotero.org/settings/keys");
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "zotero isn't answering right now — try again in a bit", 503);
      const page = (await res.json()) as ZoteroItem[];
      rows.push(...page);
      if (page.length < 100) break;
    }
    return { label: null, items: zoteroItems(rows), seen: rows.length };
  },
};

// ------------------------------------------------------------------ github

type GhRepo = { full_name: string; html_url: string; description: string | null; pushed_at: string };

export function parseGithubUser(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/github\.com\/([A-Za-z0-9-]+)/i);
  if (m) s = m[1];
  return /^[A-Za-z0-9-]{1,39}$/.test(s) ? s : null;
}

/** Starred repos, read as pages (the README is the substance). 60 requests/hour unauthenticated, so one page per sync. */
export const github: Provider = {
  key: "github",
  async link(input) {
    const user = parseGithubUser(input);
    if (!user) throw new ProviderError("INVALID_INPUT", "that doesn't look like a github username");
    const res = await providerFetch(`https://api.github.com/users/${user}`, { providerName: "github", headers: { accept: "application/vnd.github+json" } });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find "${user}" on github — check the spelling`);
    if (res.status === 403) throw new ProviderError("UNAVAILABLE", "github is rate-limiting us — try again in an hour", 503);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "github isn't answering right now — try again in a bit", 503);
    const profile = (await res.json()) as { login: string; name?: string | null };
    return { handle: profile.login, label: profile.name || profile.login };
  },
  async fetch({ handle }) {
    const res = await providerFetch(`https://api.github.com/users/${handle}/starred?per_page=100`, { providerName: "github", headers: { accept: "application/vnd.github.star+json" } });
    if (res.status === 404) throw new ProviderError("NOT_FOUND", "that github account is gone");
    if (res.status === 403) throw new ProviderError("UNAVAILABLE", "github is rate-limiting us — it'll catch up on the next pass", 503);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "github isn't answering right now — try again in a bit", 503);
    const rows = (await res.json()) as ({ starred_at?: string; repo?: GhRepo } & Partial<GhRepo>)[];
    const items: ProviderItem[] = rows.map((r) => {
      const repo = r.repo ?? (r as GhRepo);
      return {
        externalId: `gh-${repo.full_name}`,
        title: repo.full_name,
        url: repo.html_url,
        words: "",
        description: repo.description ?? undefined,
        occurredAt: parseDate(r.starred_at) ?? parseDate(repo.pushed_at) ?? new Date(),
        mode: "link" as const,
      };
    });
    return { label: null, items, seen: rows.length };
  },
};
