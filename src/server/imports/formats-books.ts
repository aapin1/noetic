import { clampText, hasWords, htmlToText, parseDate, starsFromRating } from "@/server/connections/text";
import type { ProviderItem } from "@/server/connections/types";
import { hasColumns, pick, slugTitle, tableRecords, unformula, year } from "./table";
import type { ImportFormat } from "./types";

/**
 * Book exports. Each row is a book the person read; a review makes it words,
 * otherwise it's a bare read that the work resolver can turn into a page.
 */

const REVIEW_MAX = 6000;
const QUOTE_MAX = 6000;

function bookItem(args: {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  url?: string;
  words: string;
  quote?: string;
  rating?: string | null;
  date?: Date | null;
  year?: number;
}): ProviderItem {
  const words = clampText(args.words, REVIEW_MAX);
  return {
    externalId: args.id,
    title: args.title,
    url: args.url ?? "",
    words: hasWords(words) ? words : "",
    quote: args.quote ? clampText(args.quote, QUOTE_MAX) : undefined,
    author: args.author || undefined,
    rating: args.rating ?? undefined,
    occurredAt: args.date ?? new Date(),
    lookup: { kind: "book", title: args.title, author: args.author || undefined, year: args.year },
  };
}

export const goodreadsCsv: ImportFormat = {
  key: "goodreads-csv",
  label: "goodreads export",
  detect: (text, name) => hasColumns(text, "book id", "title", "author", "my rating") || /goodreads_library_export/i.test(name ?? ""),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const title = pick(r, "title");
      if (!title) continue;
      const bookId = pick(r, "book id");
      const review = htmlToText(pick(r, "my review"));
      const notes = pick(r, "private notes");
      const words = [review, notes].filter(hasWords).join("\n\n");
      const rating = starsFromRating(pick(r, "my rating"));
      items.push(
        bookItem({
          id: `gr-${bookId || slugTitle(title)}`,
          title,
          author: pick(r, "author"),
          isbn: unformula(pick(r, "isbn13", "isbn")),
          url: bookId ? `https://www.goodreads.com/book/show/${bookId}` : undefined,
          words,
          rating: [rating, pick(r, "exclusive shelf")].filter(Boolean).join(" · ") || null,
          date: parseDate(pick(r, "date read").replace(/\//g, "-")) ?? parseDate(pick(r, "date added").replace(/\//g, "-")),
          year: year(pick(r, "original publication year", "year published")),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

export const storygraphCsv: ImportFormat = {
  key: "storygraph-csv",
  label: "storygraph export",
  detect: (text) => hasColumns(text, "title", "authors", "read status", "star rating"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const title = pick(r, "title");
      if (!title) continue;
      const rating = starsFromRating(pick(r, "star rating"));
      items.push(
        bookItem({
          id: `sg-${slugTitle(title)}`,
          title,
          author: pick(r, "authors"),
          isbn: pick(r, "isbn/uid"),
          words: pick(r, "review"),
          rating: [rating, pick(r, "read status")].filter(Boolean).join(" · ") || null,
          date: parseDate(pick(r, "last date read").replace(/\//g, "-")) ?? parseDate(pick(r, "date added").replace(/\//g, "-")),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

export const librarythingTsv: ImportFormat = {
  key: "librarything-tsv",
  label: "librarything export",
  detect: (text) => /^(﻿)?"?book id"?\t/i.test(text) || (text.includes("\t") && hasColumns(text, "book id", "title", "primary author")),
  parse: (text) => {
    const { rows } = tableRecords(text, "\t");
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const title = pick(r, "title");
      if (!title) continue;
      const words = [htmlToText(pick(r, "review")), pick(r, "comment"), pick(r, "private comment")].filter(hasWords).join("\n\n");
      const rating = starsFromRating(pick(r, "rating"));
      const bookId = pick(r, "book id");
      items.push(
        bookItem({
          id: `lt-${bookId || slugTitle(title)}`,
          title,
          author: pick(r, "primary author"),
          words,
          rating,
          date: parseDate(pick(r, "date read").replace(/[\[\]]/g, "")) ?? parseDate(pick(r, "entry date").replace(/[\[\]]/g, "")),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

export const bookwyrmCsv: ImportFormat = {
  key: "bookwyrm-csv",
  label: "bookwyrm export",
  detect: (text) => hasColumns(text, "title", "author text", "review content"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const title = pick(r, "title");
      if (!title) continue;
      const remote = pick(r, "remote id");
      items.push(
        bookItem({
          id: `bwx-${remote || slugTitle(title)}`,
          title,
          author: pick(r, "author text"),
          url: /^https?:\/\//.test(remote) ? remote : undefined,
          words: htmlToText(pick(r, "review content")),
          rating: starsFromRating(pick(r, "rating")),
          date: parseDate(pick(r, "finish date")) ?? parseDate(pick(r, "shelf date")),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

export const readwiseCsv: ImportFormat = {
  key: "readwise-csv",
  label: "readwise export",
  detect: (text) => hasColumns(text, "highlight", "book title"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    // One capture per book, highlights joined — the same grouping the live Readwise connection uses.
    const byBook = new Map<string, { title: string; author: string; quotes: string[]; notes: string[]; url: string; date: Date | null }>();
    for (const r of rows) {
      const title = pick(r, "book title");
      const highlight = pick(r, "highlight");
      if (!title || !highlight) continue;
      const g = byBook.get(title) ?? { title, author: pick(r, "book author", "author"), quotes: [], notes: [], url: pick(r, "url", "source url"), date: null };
      g.quotes.push(highlight);
      const note = pick(r, "note");
      if (note) g.notes.push(note);
      const d = parseDate(pick(r, "highlighted at", "date"));
      if (d && (!g.date || d > g.date)) g.date = d;
      byBook.set(title, g);
    }
    const items: ProviderItem[] = [];
    for (const g of byBook.values()) {
      items.push({
        externalId: `rwx-${slugTitle(g.title)}`,
        title: g.title,
        url: /^https?:\/\//.test(g.url) ? g.url : "",
        words: clampText(g.notes.join("\n\n"), REVIEW_MAX),
        quote: clampText(g.quotes.join("\n\n"), QUOTE_MAX),
        author: g.author || undefined,
        occurredAt: g.date ?? new Date(),
        lookup: /^https?:\/\//.test(g.url) ? undefined : { kind: "book", title: g.title, author: g.author || undefined },
      });
    }
    return { items, seen: rows.length };
  },
};

/**
 * Kindle's "My Clippings.txt": records separated by `==========`, each a
 * title line "(Author)", a metadata line (Highlight | Note | Bookmark, page,
 * location, Added on …), a blank line, the body. Notes follow the highlight
 * they annotate, at the same location. Append-only, so duplicates happen.
 */
export const kindleClippings: ImportFormat = {
  key: "kindle-clippings",
  label: "kindle clippings",
  detect: (text, name) => /my clippings/i.test(name ?? "") || (/^={10}$/m.test(text) && /- (Your|Ihre|Votre|Tu) (Highlight|Note|Bookmark|Markierung|surlignement|subrayado)/i.test(text)),
  parse: (text) => {
    const records = text.replace(/^﻿/, "").split(/\r?\n={10}\r?\n?/);
    const byBook = new Map<string, { title: string; author: string; quotes: string[]; notes: string[]; date: Date | null; seen: Set<string> }>();
    let seen = 0;
    for (const raw of records) {
      const lines = raw.split(/\r?\n/).filter((l, i) => i < 2 || l.trim() !== "" || false);
      if (lines.length < 3) continue;
      const head = lines[0].trim();
      const meta = lines[1].trim();
      const body = lines.slice(2).join("\n").trim();
      if (!body) continue;
      seen += 1;
      const kind = /Note|Notiz|note/i.test(meta) && !/Highlight|Markierung/i.test(meta) ? "note" : /Bookmark|Lesezeichen|signet|marcador/i.test(meta) ? "bookmark" : "highlight";
      if (kind === "bookmark") continue;
      const m = head.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
      const title = (m ? m[1] : head).trim();
      const author = m ? m[2].trim() : "";
      const g = byBook.get(title) ?? { title, author, quotes: [], notes: [], date: null, seen: new Set<string>() };
      if (g.seen.has(body)) continue;
      g.seen.add(body);
      (kind === "note" ? g.notes : g.quotes).push(body);
      const added = meta.match(/Added on (.*)$/i)?.[1];
      const d = parseDate(added?.replace(/^\w+,\s*/, ""));
      if (d && (!g.date || d > g.date)) g.date = d;
      byBook.set(title, g);
    }
    const items: ProviderItem[] = [];
    for (const g of byBook.values()) {
      if (g.quotes.length === 0 && g.notes.length === 0) continue;
      items.push({
        externalId: `kc-${slugTitle(g.title)}`,
        title: g.title,
        url: "",
        words: clampText(g.notes.join("\n\n"), REVIEW_MAX),
        quote: clampText(g.quotes.join("\n\n"), QUOTE_MAX),
        author: g.author || undefined,
        occurredAt: g.date ?? new Date(),
        lookup: { kind: "book", title: g.title, author: g.author || undefined },
      });
    }
    return { items, seen };
  },
};

/** Kindle notebook, as handed over by the in-app sign-in (see imports/session). */
export const kindleNotebookJson: ImportFormat = {
  key: "kindle-notebook",
  label: "kindle highlights",
  detect: (text, name) => /kindle-notebook\.json$/i.test(name ?? "") || /^\s*\{\s*"source"\s*:\s*"kindle-notebook"/.test(text),
  parse: (text) => {
    const data = JSON.parse(text) as { books: { asin: string; title: string; author?: string; highlights: { text: string; note?: string | null; location?: string | null }[]; lastAnnotated?: string | null }[] };
    const items: ProviderItem[] = [];
    let seen = 0;
    for (const b of data.books ?? []) {
      seen += b.highlights.length;
      const quotes = b.highlights.map((h) => h.text?.trim()).filter(Boolean) as string[];
      const notes = b.highlights.map((h) => h.note?.trim()).filter(Boolean) as string[];
      if (quotes.length === 0 && notes.length === 0) continue;
      items.push({
        externalId: `kn-${b.asin}`,
        title: b.title,
        url: `https://www.amazon.com/dp/${b.asin}`,
        words: clampText(notes.join("\n\n"), REVIEW_MAX),
        quote: clampText(quotes.join("\n\n"), QUOTE_MAX),
        author: b.author?.replace(/^By:\s*/i, "") || undefined,
        occurredAt: parseDate(b.lastAnnotated) ?? new Date(),
      });
    }
    return { items, seen };
  },
};

export const BOOK_FORMATS = [goodreadsCsv, storygraphCsv, librarythingTsv, bookwyrmCsv, readwiseCsv, kindleClippings, kindleNotebookJson];
