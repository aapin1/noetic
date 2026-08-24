import { providerFetch } from "./http";
import { clampText, hasWords, parseDate } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Trakt: public profiles are readable with only an app client id (no user
 * OAuth), and `/users/{slug}/comments` returns everything the person has
 * written about films and shows — the one Trakt feed that carries words.
 * Ratings and history are activity, not thought, and are left alone.
 *
 * Needs `TRAKT_CLIENT_ID` (free: trakt.tv/oauth/applications/new). Without
 * it the provider says so rather than guessing.
 */

const API = "https://api.trakt.tv";
const COMMENT_MAX = 6000;
const PAGE_LIMIT = 100;
const MAX_PAGES = 3;

type Ids = { trakt: number; slug?: string };
type TraktComment = {
  type: "movie" | "show" | "season" | "episode" | "list";
  movie?: { title: string; year: number | null; ids: Ids };
  show?: { title: string; year: number | null; ids: Ids };
  season?: { number: number };
  episode?: { season: number; number: number; title: string | null };
  list?: { name: string };
  comment: {
    id: number;
    comment: string;
    spoiler: boolean;
    review: boolean;
    created_at: string;
    updated_at: string;
    user_stats?: { rating: number | null };
  };
};

export function parseTraktHandle(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/trakt\.tv\/users\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/\/.*$/, "");
  return /^[a-z0-9_.-]{1,40}$/i.test(s) ? s.toLowerCase() : null;
}

function clientId(): string {
  const id = process.env.TRAKT_CLIENT_ID;
  if (!id) throw new ProviderError("UNAVAILABLE", "trakt isn't switched on for mneme yet — check back soon", 503);
  return id;
}

async function call(path: string): Promise<Response> {
  const res = await providerFetch(`${API}${path}`, {
    providerName: "trakt",
    headers: { "content-type": "application/json", "trakt-api-version": "2", "trakt-api-key": clientId() },
  });
  if (res.status === 429) throw new ProviderError("UNAVAILABLE", "trakt is rate-limiting us — it'll catch up on the next pass", 503);
  return res;
}

function titleOf(c: TraktComment): string {
  const year = (t: { title: string; year: number | null }) => (t.year ? `${t.title} (${t.year})` : t.title);
  if (c.type === "movie" && c.movie) return year(c.movie);
  if (c.type === "show" && c.show) return year(c.show);
  if (c.type === "season" && c.show && c.season) return `${c.show.title} — season ${c.season.number}`;
  if (c.type === "episode" && c.show && c.episode) {
    const code = `S${String(c.episode.season).padStart(2, "0")}E${String(c.episode.number).padStart(2, "0")}`;
    return `${c.show.title} ${code}${c.episode.title ? ` — ${c.episode.title}` : ""}`;
  }
  if (c.type === "list" && c.list) return `list: ${c.list.name}`;
  return "Untitled";
}

/** Pure; exported for tests. */
export function traktItems(comments: TraktComment[]): ProviderItem[] {
  const items: ProviderItem[] = [];
  for (const c of comments) {
    const words = clampText((c.comment.comment ?? "").trim(), COMMENT_MAX);
    if (!hasWords(words)) continue;
    const rating = c.comment.user_stats?.rating;
    items.push({
      externalId: `trakt-${c.comment.id}`,
      title: titleOf(c),
      url: `https://trakt.tv/comments/${c.comment.id}`,
      words,
      rating: rating ? `${rating}/10${c.comment.review ? " · review" : ""}` : c.comment.review ? "review" : undefined,
      occurredAt: parseDate(c.comment.created_at) ?? new Date(),
    });
  }
  return items;
}

export const trakt: Provider = {
  key: "trakt",
  async link(input) {
    const slug = parseTraktHandle(input);
    if (!slug) throw new ProviderError("INVALID_INPUT", "that doesn't look like a trakt username — it's the part after trakt.tv/users/");
    const res = await call(`/users/${encodeURIComponent(slug)}`);
    if (res.status === 404) throw new ProviderError("NOT_FOUND", `couldn't find a trakt called "${slug}" — check the spelling`);
    if (res.status === 401) throw new ProviderError("PRIVATE", "that trakt profile is private — make it public in trakt settings, then try again");
    if (res.status === 403) throw new ProviderError("UNAVAILABLE", "trakt isn't switched on for mneme yet — check back soon", 503);
    if (!res.ok) throw new ProviderError("UNAVAILABLE", "trakt isn't answering right now — try again in a bit", 503);
    const profile = (await res.json()) as { username: string; private: boolean; name?: string | null; ids: { slug: string } };
    if (profile.private) throw new ProviderError("PRIVATE", "that trakt profile is private — make it public in trakt settings, then try again");
    return { handle: profile.ids.slug, label: profile.name || profile.username };
  },
  async fetch({ handle }) {
    const all: TraktComment[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const res = await call(`/users/${encodeURIComponent(handle)}/comments/all/all?page=${page}&limit=${PAGE_LIMIT}`);
      if (res.status === 401) throw new ProviderError("PRIVATE", "that trakt profile went private — make it public in trakt settings to keep syncing");
      if (res.status === 404) throw new ProviderError("NOT_FOUND", "that trakt account no longer exists");
      if (!res.ok) throw new ProviderError("UNAVAILABLE", "trakt isn't answering right now — try again in a bit", 503);
      const rows = (await res.json()) as TraktComment[];
      all.push(...rows);
      const pageCount = Number(res.headers.get("x-pagination-page-count") ?? "1");
      if (rows.length < PAGE_LIMIT || page >= pageCount) break;
    }
    return { label: null, items: traktItems(all), seen: all.length };
  },
};
