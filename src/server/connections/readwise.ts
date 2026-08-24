import { providerFetch } from "./http";
import { clampText, hasWords } from "./text";
import { ProviderError, type Provider, type ProviderFeed, type ProviderItem } from "./types";

/**
 * Readwise: `GET /api/v2/export/` with `Authorization: Token …` returns every
 * highlight the person has saved, grouped by source ("book"), with their own
 * `note` on each. `updatedAfter` + `pageCursor` make ongoing pulls cheap.
 * Token check: `GET /api/v2/auth/` → 204, or 401 `{"detail":"Invalid token."}`.
 * Verified against the live API 2026-08-23.
 *
 * Highlights are grouped one capture per source per sync: a highlight is a
 * passage the person chose, and the pipeline does better with a page of
 * them than with a thousand one-line nodes.
 */

const API = "https://readwise.io/api/v2";
const QUOTE_MAX = 6000;
const NOTES_MAX = 2000;
/** Pages per sync. 100 sources per page × 5 is plenty; the cursor resumes next day. */
const MAX_PAGES = 5;
/** Overlap so an edit that lands during a sync is not missed. */
const CURSOR_OVERLAP_MS = 60 * 60 * 1000;

type ReadwiseHighlight = {
  id: number;
  text: string;
  note: string | null;
  highlighted_at: string | null;
  updated_at: string | null;
  is_deleted?: boolean;
  is_discard?: boolean;
};

type ReadwiseBook = {
  user_book_id: number;
  title: string;
  author: string | null;
  readable_title?: string | null;
  source_url: string | null;
  readwise_url: string | null;
  cover_image_url: string | null;
  category: string | null;
  is_deleted?: boolean;
  highlights: ReadwiseHighlight[];
};

type ExportPage = { count: number; nextPageCursor: string | null; results: ReadwiseBook[] };

export function parseReadwiseToken(input: string): string | null {
  const s = input.trim().replace(/^token\s+/i, "");
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

function headers(token: string): Record<string, string> {
  return { authorization: `Token ${token}`, accept: "application/json" };
}

const BAD_TOKEN = "readwise didn't accept that token — copy it again from readwise.io/access_token";

async function call(token: string, path: string): Promise<Response> {
  const res = await providerFetch(`${API}${path}`, { providerName: "readwise", headers: headers(token) });
  if (res.status === 401 || res.status === 403) throw new ProviderError("BAD_TOKEN", BAD_TOKEN);
  if (res.status === 429) {
    throw new ProviderError("UNAVAILABLE", "readwise is rate-limiting us — it'll catch up on the next pass", 503);
  }
  if (!res.ok) throw new ProviderError("UNAVAILABLE", "readwise isn't answering right now — try again in a bit", 503);
  return res;
}

/**
 * Pure: books → one item per source with words. Exported for tests.
 * `externalId` is the sorted highlight ids, so a source that gains new
 * highlights later becomes a fresh capture for just those highlights once
 * the ledger has filtered the old ones out.
 */
export function groupReadwise(books: ReadwiseBook[], alreadySeen: ReadonlySet<string>): ProviderItem[] {
  const items: ProviderItem[] = [];
  for (const book of books) {
    if (book.is_deleted) continue;
    const fresh = book.highlights
      .filter((h) => !h.is_deleted && !h.is_discard && h.text?.trim())
      .filter((h) => !alreadySeen.has(highlightKey(h.id)))
      .sort((a, b) => a.id - b.id);
    if (fresh.length === 0) continue;

    const quote = clampText(fresh.map((h) => h.text.trim()).join("\n\n"), QUOTE_MAX);
    const notes = clampText(
      fresh.map((h) => h.note?.trim()).filter((n): n is string => !!n).join("\n\n"),
      NOTES_MAX,
    );
    if (!hasWords(quote) && !hasWords(notes)) continue;

    const dates = fresh
      .map((h) => new Date(h.highlighted_at ?? h.updated_at ?? ""))
      .filter((d) => !Number.isNaN(d.getTime()));
    const occurredAt = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : new Date();

    items.push({
      externalId: fresh.map((h) => highlightKey(h.id)).join(","),
      title: (book.readable_title || book.title || "Untitled").trim(),
      url: book.source_url || book.readwise_url || `https://readwise.io/bookreview/${book.user_book_id}`,
      words: notes,
      quote,
      author: book.author?.trim() || undefined,
      imageUrl: book.cover_image_url || undefined,
      occurredAt,
    });
  }
  return items;
}

export function highlightKey(id: number): string {
  return `rw-${id}`;
}

export const readwise: Provider & {
  fetchWithLedger: (args: { secret: string; cursor: string | null; alreadySeen: ReadonlySet<string> }) => Promise<ProviderFeed>;
} = {
  key: "readwise",
  async link(input) {
    const token = parseReadwiseToken(input);
    if (!token) throw new ProviderError("INVALID_INPUT", BAD_TOKEN);
    await call(token, "/auth/");
    return { handle: "token", secret: token, label: "readwise" };
  },
  // The plain fetch has no ledger to filter against; the sync loop calls
  // fetchWithLedger instead. Kept so the Provider shape stays uniform.
  async fetch({ secret, cursor }) {
    if (!secret) throw new ProviderError("BAD_TOKEN", BAD_TOKEN);
    return readwise.fetchWithLedger({ secret, cursor, alreadySeen: new Set() });
  },
  async fetchWithLedger({ secret, cursor, alreadySeen }) {
    const books: ReadwiseBook[] = [];
    let pageCursor: string | null = null;
    let newest = cursor ? new Date(cursor).getTime() : 0;
    let seen = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams();
      if (cursor) params.set("updatedAfter", new Date(new Date(cursor).getTime() - CURSOR_OVERLAP_MS).toISOString());
      if (pageCursor) params.set("pageCursor", pageCursor);
      const res = await call(secret, `/export/?${params.toString()}`);
      const data = (await res.json()) as ExportPage;
      books.push(...data.results);
      for (const b of data.results) {
        seen += b.highlights.length;
        for (const h of b.highlights) {
          const t = new Date(h.updated_at ?? "").getTime();
          if (Number.isFinite(t) && t > newest) newest = t;
        }
      }
      pageCursor = data.nextPageCursor;
      if (!pageCursor) break;
    }

    return {
      label: "readwise",
      items: groupReadwise(books, alreadySeen),
      seen,
      // Only advance when the whole window was read; a partial read keeps the
      // old cursor so the remainder comes next time (the ledger dedupes).
      cursor: pageCursor ? cursor : newest ? new Date(newest).toISOString() : cursor,
    };
  },
};
