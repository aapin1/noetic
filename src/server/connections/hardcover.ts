import { providerFetch } from "./http";
import { clampText, hasWords, htmlToText, parseDate, starsFromRating } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Hardcover: GraphQL behind the person's own API token (hardcover.app/account/api).
 * Nothing is public, so the token is the connection. `user_books` with
 * `has_review` gives every book they wrote about; ratings alone stay put.
 * Free tier is 60 req/min, 5,000/day — a sync is two or three requests.
 */

const API = "https://api.hardcover.app/v1/graphql";
const REVIEW_MAX = 6000;
const PAGE = 100;
const MAX_PAGES = 3;

const ME = `query { me { id username } }`;
const REVIEWS = `
query ($userId: Int!, $limit: Int!, $offset: Int!) {
  user_books(
    where: { user_id: { _eq: $userId }, has_review: { _eq: true } }
    order_by: { reviewed_at: desc }
    limit: $limit
    offset: $offset
  ) {
    id status_id rating review review_raw reviewed_at last_read_date date_added updated_at
    book { id title slug image { url } contributions { author { name } } }
  }
}`;

type UserBook = {
  id: number;
  status_id: number;
  rating: number | null;
  review: string | null;
  review_raw: string | null;
  reviewed_at: string | null;
  last_read_date: string | null;
  date_added: string | null;
  updated_at: string | null;
  book: {
    id: number;
    title: string | null;
    slug: string | null;
    image: { url: string | null } | null;
    contributions: { author: { name: string | null } | null }[];
  } | null;
};

const BAD_TOKEN = "hardcover didn't accept that token — copy it again from hardcover.app/account/api";

export function parseHardcoverToken(input: string): string | null {
  const s = input.trim().replace(/^bearer\s+/i, "");
  return /^[A-Za-z0-9._-]{20,}$/.test(s) ? s : null;
}

async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await providerFetch(API, {
    providerName: "hardcover",
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) throw new ProviderError("BAD_TOKEN", BAD_TOKEN);
  if (res.status === 429) throw new ProviderError("UNAVAILABLE", "hardcover is rate-limiting us — it'll catch up on the next pass", 503);
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "hardcover isn't answering right now — try again in a bit", 503);
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!body?.data || body.errors?.length) {
    if (body?.errors?.some((e) => /jwt|token|unauthor/i.test(e.message))) throw new ProviderError("BAD_TOKEN", BAD_TOKEN);
    throw new ProviderError("UNAVAILABLE", "hardcover isn't answering right now — try again in a bit", 503);
  }
  return body.data;
}

const STATUS: Record<number, string> = { 1: "want to read", 2: "reading", 3: "read", 4: "paused", 5: "did not finish" };

/** Pure; exported for tests. */
export function hardcoverItems(rows: UserBook[]): ProviderItem[] {
  const items: ProviderItem[] = [];
  for (const r of rows) {
    const words = clampText((r.review_raw?.trim() || htmlToText(r.review)).trim(), REVIEW_MAX);
    if (!hasWords(words) || !r.book) continue;
    const stars = starsFromRating(r.rating);
    const status = STATUS[r.status_id];
    items.push({
      externalId: `hc-${r.id}`,
      title: r.book.title?.trim() || "Untitled",
      url: r.book.slug ? `https://hardcover.app/books/${r.book.slug}` : `https://hardcover.app/books/${r.book.id}`,
      words,
      author: r.book.contributions?.[0]?.author?.name ?? undefined,
      imageUrl: r.book.image?.url ?? undefined,
      rating: [stars, status].filter(Boolean).join(" · ") || undefined,
      occurredAt: parseDate(r.last_read_date) ?? parseDate(r.reviewed_at) ?? parseDate(r.updated_at) ?? parseDate(r.date_added) ?? new Date(),
    });
  }
  return items;
}

export const hardcover: Provider = {
  key: "hardcover",
  async link(input) {
    const token = parseHardcoverToken(input);
    if (!token) throw new ProviderError("INVALID_INPUT", BAD_TOKEN);
    const data = await gql<{ me: { id: number; username: string }[] }>(token, ME);
    const me = data.me?.[0];
    if (!me) throw new ProviderError("BAD_TOKEN", BAD_TOKEN);
    return { handle: String(me.id), secret: token, label: me.username };
  },
  async fetch({ handle, secret }) {
    if (!secret) throw new ProviderError("BAD_TOKEN", BAD_TOKEN);
    const userId = Number(handle);
    const rows: UserBook[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await gql<{ user_books: UserBook[] }>(secret, REVIEWS, { userId, limit: PAGE, offset: page * PAGE });
      rows.push(...data.user_books);
      if (data.user_books.length < PAGE) break;
    }
    return { label: null, items: hardcoverItems(rows), seen: rows.length };
  },
};
