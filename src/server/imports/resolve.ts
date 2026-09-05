import { identifyWork } from "@/server/cognition/llm";
import { providerFetch } from "@/server/connections/http";
import { clampText, htmlToText } from "@/server/connections/text";
import type { ProviderItem } from "@/server/connections/types";

/**
 * Turn a bare title ("Heat", 1995) into a page the link pipeline can read.
 * Keyless throughout: Wikipedia for film/TV/albums, Open Library for books,
 * AniList for anime, Steam's store for games. Wikipedia's policy wants an
 * identifying user agent and ≤200 requests/min; every call here is one
 * search plus one summary, throttled by the caller.
 * Verified live 2026-08-23.
 */

const WIKI_UA = "Mneme/1.0 (https://mneme-app.com; hello@mneme-app.com) connections-resolver";

export type Resolved = { url: string; title: string; description?: string; imageUrl?: string; author?: string };

const cache = new Map<string, Promise<Resolved | null>>();

function cacheKey(lookup: NonNullable<ProviderItem["lookup"]>): string {
  return `${lookup.kind}|${lookup.title.toLowerCase()}|${lookup.year ?? ""}|${(lookup.author ?? "").toLowerCase()}`;
}

export function resolveWork(lookup: NonNullable<ProviderItem["lookup"]>): Promise<Resolved | null> {
  const key = cacheKey(lookup);
  let p = cache.get(key);
  if (!p) {
    p = resolveUncached(lookup).catch(() => null);
    cache.set(key, p);
    if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

const recalled = new Map<string, Promise<string | null>>();

/**
 * What the work is, from the model's own knowledge — the backstop for when
 * every keyless source above missed. Description only: there is no page, so
 * `resolveWork`'s contract (a readable URL) is left alone and only the
 * description hole is filled. Cached per work like the resolvers, so a sync
 * that logs the same film twice asks once.
 */
export function recallWork(lookup: NonNullable<ProviderItem["lookup"]>): Promise<string | null> {
  const key = cacheKey(lookup);
  let p = recalled.get(key);
  if (!p) {
    p = identifyWork(lookup).catch(() => null);
    recalled.set(key, p);
    if (recalled.size > 5000) recalled.delete(recalled.keys().next().value as string);
  }
  return p;
}

const quiet = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

async function resolveUncached(lookup: NonNullable<ProviderItem["lookup"]>): Promise<Resolved | null> {
  switch (lookup.kind) {
    case "book":
      return (await quiet(openLibrary(lookup.title, lookup.author))) ?? wikipedia(lookup.title, lookup.year, "book");
    case "anime":
      return (await quiet(anilist(lookup.title))) ?? wikipedia(lookup.title, lookup.year, "anime");
    case "game":
      return (await quiet(steam(lookup.title))) ?? wikipedia(lookup.title, lookup.year, "game");
    case "album":
      return wikipedia(`${lookup.title} ${lookup.author ?? ""}`.trim(), lookup.year, "album");
    default:
      return wikipedia(lookup.title, lookup.year, lookup.kind);
  }
}

const TEMPLATE: Record<string, string> = {
  film: 'hastemplate:"Infobox film"',
  tv: 'hastemplate:"Infobox television"',
  album: 'hastemplate:"Infobox album"',
  book: 'hastemplate:"Infobox book"',
  game: 'hastemplate:"Infobox video game"',
  anime: 'hastemplate:"Infobox animanga/Header"',
};

type WikiPage = { title: string; description?: string; pageprops?: { disambiguation?: string } };

async function wikipedia(title: string, year: number | undefined, kind: string): Promise<Resolved | null> {
  const q = `${title} ${year ?? ""} ${TEMPLATE[kind] ?? ""}`.trim();
  const params = new URLSearchParams({ action: "query", generator: "search", gsrsearch: q, gsrlimit: "5", prop: "description|pageprops", ppprop: "disambiguation", format: "json" });
  const res = await providerFetch(`https://en.wikipedia.org/w/api.php?${params}`, { providerName: "wikipedia", headers: { "user-agent": WIKI_UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
  const pages = Object.values(data.query?.pages ?? {}).filter((p) => !p.pageprops?.disambiguation);
  if (pages.length === 0) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = norm(title);
  const scored = pages
    .map((p) => {
      const base = norm(p.title.replace(/\s*\(.*\)$/, ""));
      let score = base === wanted ? 3 : base.includes(wanted) || wanted.includes(base) ? 1 : 0;
      if (year && (p.description ?? "").includes(String(year))) score += 2;
      if (year && /\b(19|20)\d{2}\b/.test(p.description ?? "") && !(p.description ?? "").includes(String(year)) && !(p.description ?? "").includes(String(year - 1)) && !(p.description ?? "").includes(String(year + 1))) score -= 1;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  const summary = await providerFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best.p.title.replace(/ /g, "_"))}`, { providerName: "wikipedia", headers: { "user-agent": WIKI_UA } });
  if (!summary.ok) return null;
  const s = (await summary.json()) as { type?: string; title: string; extract?: string; thumbnail?: { source: string }; content_urls?: { desktop?: { page: string } } };
  if (s.type !== "standard" || !s.content_urls?.desktop?.page) return null;
  return { url: s.content_urls.desktop.page, title: s.title, description: s.extract ? clampText(s.extract, 1200) : undefined, imageUrl: s.thumbnail?.source };
}

async function openLibrary(title: string, author?: string): Promise<Resolved | null> {
  const params = new URLSearchParams({ title, limit: "1", fields: "key,title,author_name,cover_i" });
  if (author) params.set("author", author);
  const res = await providerFetch(`https://openlibrary.org/search.json?${params}`, { providerName: "open library", headers: { "user-agent": WIKI_UA } });
  if (!res.ok) return null;
  const data = (await res.json()) as { docs: { key: string; title: string; author_name?: string[]; cover_i?: number }[] };
  const doc = data.docs[0];
  if (!doc?.key) return null;
  let description: string | undefined;
  try {
    const work = await providerFetch(`https://openlibrary.org${doc.key}.json`, { providerName: "open library", headers: { "user-agent": WIKI_UA } });
    if (work.ok) {
      const w = (await work.json()) as { description?: string | { value: string } };
      const d = typeof w.description === "string" ? w.description : w.description?.value;
      if (d) description = clampText(htmlToText(d), 1200);
    }
  } catch {
    /* the page is enough */
  }
  return { url: `https://openlibrary.org${doc.key}`, title: doc.title, author: doc.author_name?.[0], description, imageUrl: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : undefined };
}

async function anilist(title: string): Promise<Resolved | null> {
  const res = await providerFetch("https://graphql.anilist.co", {
    providerName: "anilist",
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: `query ($q: String) { Media(search: $q, type: ANIME) { siteUrl description(asHtml: false) title { english romaji } coverImage { large } } }`, variables: { q: title } }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { Media?: { siteUrl: string; description?: string | null; title: { english?: string | null; romaji?: string | null }; coverImage?: { large?: string } } | null } };
  const m = data.data?.Media;
  if (!m) return null;
  return { url: m.siteUrl, title: m.title.english || m.title.romaji || title, description: m.description ? clampText(htmlToText(m.description), 1200) : undefined, imageUrl: m.coverImage?.large };
}

async function steam(title: string): Promise<Resolved | null> {
  const res = await providerFetch(`https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(title)}`, { providerName: "steam" });
  if (!res.ok) return null;
  const apps = (await res.json()) as { appid: string; name: string }[];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const app = apps.find((a) => norm(a.name) === norm(title)) ?? apps[0];
  if (!app) return null;
  const details = await providerFetch(`https://store.steampowered.com/api/appdetails?appids=${app.appid}&filters=basic`, { providerName: "steam" });
  const d = details.ok ? ((await details.json()) as Record<string, { data?: { short_description?: string; header_image?: string } }>)[app.appid]?.data : undefined;
  return { url: `https://store.steampowered.com/app/${app.appid}/`, title: app.name, description: d?.short_description ? clampText(htmlToText(d.short_description), 600) : undefined, imageUrl: d?.header_image };
}
