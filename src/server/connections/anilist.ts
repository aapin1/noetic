import { providerFetch } from "./http";
import { clampText, hasWords, htmlToText } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * AniList: public GraphQL, no auth. A person's anime and manga lists with
 * their own `notes` on each entry. Private lists answer "Private User";
 * unknown names "User not found". Verified live 2026-08-23. Rate limit is
 * 30/min in AniList's current degraded state, so a sync is exactly three
 * requests.
 */

const API = "https://graphql.anilist.co";
const NOTES_MAX = 4000;
const BLURB_MAX = 1200;

const LIST_QUERY = `
query ($name: String, $type: MediaType) {
  MediaListCollection(userName: $name, type: $type) {
    user { name }
    lists {
      entries {
        id status notes updatedAt
        score(format: POINT_10_DECIMAL)
        completedAt { year month day }
        media {
          id siteUrl description(asHtml: false) genres format
          title { romaji english }
          coverImage { large }
        }
      }
    }
  }
}`;

type Entry = {
  id: number;
  status: string;
  notes: string | null;
  updatedAt: number;
  score: number | null;
  completedAt: { year: number | null; month: number | null; day: number | null } | null;
  media: {
    id: number;
    siteUrl: string;
    description: string | null;
    genres: string[];
    format: string | null;
    title: { romaji: string | null; english: string | null };
    coverImage: { large: string | null } | null;
  };
};

export function parseAnilistHandle(input: string): string | null {
  let s = input.trim().replace(/^@/, "");
  const m = s.match(/anilist\.co\/user\/([^/?#\s]+)/i);
  if (m) s = m[1];
  s = s.replace(/\/.*$/, "");
  return /^[A-Za-z0-9_-]{2,20}$/.test(s) ? s : null;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await providerFetch(API, {
    providerName: "anilist",
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string; status?: number }[] } | null;
  // AniList stacks a generic "Not Found." first and the real reason second.
  const errors = body?.errors ?? [];
  const err = errors.find((e) => /private|not found/i.test(e.message) && !/^not found\.?$/i.test(e.message)) ?? errors[0];
  if (err) {
    if (/private/i.test(err.message)) {
      throw new ProviderError("PRIVATE", "that anilist profile is private — set your lists to public in anilist settings, then try again");
    }
    if (/not found/i.test(err.message)) {
      throw new ProviderError("NOT_FOUND", `couldn't find an anilist called "${String(variables.name)}" — check the spelling`);
    }
    throw new ProviderError("UNAVAILABLE", "anilist isn't answering right now — try again in a bit", 503);
  }
  if (res.status === 429) {
    throw new ProviderError("UNAVAILABLE", "anilist is rate-limiting us — it'll catch up on the next pass", 503);
  }
  if (!res.ok || !body?.data) {
    throw new ProviderError("UNAVAILABLE", "anilist isn't answering right now — try again in a bit", 503);
  }
  return body.data;
}

function entryDate(e: Entry): Date {
  const c = e.completedAt;
  if (c?.year && c.month && c.day) return new Date(Date.UTC(c.year, c.month - 1, c.day));
  return new Date(e.updatedAt * 1000);
}

/** Pure; exported for tests. */
export function anilistItems(entries: Entry[], kind: "anime" | "manga"): { items: ProviderItem[]; seen: number } {
  const items: ProviderItem[] = [];
  // Custom lists repeat entries that also sit in a status list.
  const unique = [...new Map(entries.map((e) => [e.id, e])).values()];
  for (const e of unique) {
    const words = clampText((e.notes ?? "").trim(), NOTES_MAX);
    if (!hasWords(words)) continue;
    const title = e.media.title.english || e.media.title.romaji || "Untitled";
    items.push({
      externalId: `anilist-${e.id}`,
      title,
      url: e.media.siteUrl,
      words,
      description: clampText(htmlToText(e.media.description), BLURB_MAX) || undefined,
      imageUrl: e.media.coverImage?.large ?? undefined,
      rating: e.score && e.score > 0 ? `${e.score}/10 · ${e.status.toLowerCase()} ${kind}` : `${e.status.toLowerCase()} ${kind}`,
      occurredAt: entryDate(e),
    });
  }
  return { items, seen: unique.length };
}

async function fetchList(name: string, type: "ANIME" | "MANGA"): Promise<{ name: string; entries: Entry[] }> {
  const data = await gql<{ MediaListCollection: { user: { name: string } | null; lists: { entries: Entry[] }[] } | null }>(LIST_QUERY, { name, type });
  return {
    name: data.MediaListCollection?.user?.name ?? name,
    entries: data.MediaListCollection?.lists.flatMap((l) => l.entries) ?? [],
  };
}

export const anilist: Provider = {
  key: "anilist",
  async link(input) {
    const handle = parseAnilistHandle(input);
    if (!handle) throw new ProviderError("INVALID_INPUT", "that doesn't look like an anilist username — try just the name");
    // The list query is the only one that distinguishes "private" from
    // "no such user" — the User query hides private accounts entirely.
    const list = await fetchList(handle, "ANIME");
    return { handle: list.name, label: list.name };
  },
  async fetch({ handle }) {
    const anime = anilistItems((await fetchList(handle, "ANIME")).entries, "anime");
    const manga = anilistItems((await fetchList(handle, "MANGA")).entries, "manga");
    return { label: handle, items: [...anime.items, ...manga.items], seen: anime.seen + manga.seen };
  },
};
