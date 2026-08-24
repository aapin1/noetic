import { load } from "cheerio";
import { clampText, hasWords, htmlToText, parseDate, starsFromRating } from "@/server/connections/text";
import type { ProviderItem } from "@/server/connections/types";
import { hasColumns, pick, slugTitle, tableRecords, year } from "./table";
import type { ImportFormat } from "./types";

/**
 * Film, TV, anime and game exports. A review makes a row words; a bare
 * watch/rating is activity the work resolver can turn into a page.
 */

const REVIEW_MAX = 6000;

function workItem(args: {
  id: string;
  title: string;
  year?: number;
  kind: "film" | "tv" | "anime" | "game";
  url?: string;
  words: string;
  rating?: string | null;
  date?: Date | null;
}): ProviderItem {
  const words = clampText(args.words, REVIEW_MAX);
  return {
    externalId: args.id,
    title: args.year ? `${args.title} (${args.year})` : args.title,
    url: args.url ?? "",
    words: hasWords(words) ? words : "",
    rating: args.rating ?? undefined,
    occurredAt: args.date ?? new Date(),
    // Kept even when a catalogue url exists: bare rows resolve to a readable page first.
    lookup: { kind: args.kind, title: args.title, year: args.year },
  };
}

/** Letterboxd's zip: reviews.csv (with Review), diary.csv, ratings.csv, watched.csv. Also accepted one file at a time. */
export const letterboxdCsv: ImportFormat = {
  key: "letterboxd-csv",
  label: "letterboxd export",
  detect: (text) => hasColumns(text, "date", "name", "year", "letterboxd uri"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const name = pick(r, "name");
      const uri = pick(r, "letterboxd uri");
      if (!name) continue;
      const y = year(pick(r, "year"));
      const rating = starsFromRating(pick(r, "rating"));
      const rewatch = /yes/i.test(pick(r, "rewatch"));
      items.push(
        workItem({
          id: `lbx-${uri ? uri.replace(/^https?:\/\/(boxd\.it|letterboxd\.com)\//, "") : slugTitle(name)}-${pick(r, "watched date", "date")}`,
          title: name,
          year: y,
          kind: "film",
          url: uri && /letterboxd\.com\/.+\/film\//.test(uri) ? uri : undefined,
          words: pick(r, "review"),
          rating: [rating, rewatch ? "rewatch" : null].filter(Boolean).join(" · ") || null,
          date: parseDate(pick(r, "watched date", "date")),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

export const imdbRatingsCsv: ImportFormat = {
  key: "imdb-ratings",
  label: "imdb ratings",
  detect: (text) => hasColumns(text, "const", "your rating", "title"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const title = pick(r, "title");
      const id = pick(r, "const");
      if (!title) continue;
      const tv = /series|episode|mini/i.test(pick(r, "title type"));
      const rating = pick(r, "your rating");
      items.push(
        workItem({
          id: `imdb-${id || slugTitle(title)}`,
          title,
          year: year(pick(r, "year")),
          kind: tv ? "tv" : "film",
          url: pick(r, "url") || (id ? `https://www.imdb.com/title/${id}/` : undefined),
          words: "",
          rating: rating ? `${rating}/10` : null,
          date: parseDate(pick(r, "date rated")),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

/** Netflix: the two-column "Download all" CSV, and the GDPR ViewingActivity.csv. Series rows look like "Show: Season 1: Episode" — collapsed to the show. */
export const netflixCsv: ImportFormat = {
  key: "netflix-csv",
  label: "netflix viewing activity",
  detect: (text) => hasColumns(text, "title", "date") || hasColumns(text, "profile name", "start time", "title"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const byShow = new Map<string, { title: string; tv: boolean; first: Date | null; last: Date | null; count: number }>();
    for (const r of rows) {
      const raw = pick(r, "title");
      if (!raw) continue;
      if (/(trailer|teaser|hook|recap|preview)/i.test(pick(r, "supplemental video type"))) continue;
      const parts = raw.split(/:\s+/);
      const tv = parts.length >= 3 || /season|episode|chapter|part \d/i.test(raw);
      const title = tv ? parts[0].trim() : raw.trim();
      const d = parseDate(pick(r, "start time", "date").replace(/(\d{1,2})\/(\d{1,2})\/(\d{2})$/, "20$3-$1-$2"));
      const g = byShow.get(title) ?? { title, tv, first: null, last: null, count: 0 };
      g.count += 1;
      if (d) {
        if (!g.first || d < g.first) g.first = d;
        if (!g.last || d > g.last) g.last = d;
      }
      byShow.set(title, g);
    }
    const items: ProviderItem[] = [];
    for (const g of byShow.values()) {
      items.push(workItem({ id: `nfx-${slugTitle(g.title)}`, title: g.title, kind: g.tv ? "tv" : "film", words: "", rating: g.tv && g.count > 1 ? `${g.count} episodes` : null, date: g.last }));
    }
    return { items, seen: rows.length };
  },
};

/** The viewing activity the in-app sign-in pulls from netflix's own api (see imports/session). */
export const netflixSessionJson: ImportFormat = {
  key: "netflix-session",
  label: "netflix viewing activity",
  detect: (text, name) => /netflix-activity\.json$/i.test(name ?? "") || /^\s*\{\s*"source"\s*:\s*"netflix"/.test(text),
  parse: (text) => {
    const data = JSON.parse(text) as { items: { title: string; series?: string | null; date?: number | string | null }[] };
    const csv = ["Title,Date", ...data.items.map((i) => `"${(i.series ? `${i.series}: ${i.title}` : i.title).replace(/"/g, '""')}","${i.date ? new Date(typeof i.date === "number" ? i.date : Date.parse(i.date)).toISOString() : ""}"`)].join("\n");
    return netflixCsv.parse(csv);
  },
};

/** Crunchyroll history as pulled by the in-app sign-in. */
export const crunchyrollSessionJson: ImportFormat = {
  key: "crunchyroll-session",
  label: "crunchyroll history",
  detect: (text, name) => /crunchyroll-history\.json$/i.test(name ?? "") || /^\s*\{\s*"source"\s*:\s*"crunchyroll"/.test(text),
  parse: (text) => {
    const data = JSON.parse(text) as { items: { series: string; episode?: string | null; date?: string | null; seriesId?: string | null }[] };
    const bySeries = new Map<string, { title: string; last: Date | null; count: number; id?: string | null }>();
    for (const i of data.items) {
      const g = bySeries.get(i.series) ?? { title: i.series, last: null, count: 0, id: i.seriesId };
      g.count += 1;
      const d = parseDate(i.date);
      if (d && (!g.last || d > g.last)) g.last = d;
      bySeries.set(i.series, g);
    }
    const items: ProviderItem[] = [];
    for (const g of bySeries.values()) {
      items.push(workItem({ id: `cr-${g.id ?? slugTitle(g.title)}`, title: g.title, kind: "anime", url: g.id ? `https://www.crunchyroll.com/series/${g.id}` : undefined, words: "", rating: g.count > 1 ? `${g.count} episodes` : null, date: g.last }));
    }
    return { items, seen: data.items.length };
  },
};

export const grouveeCsv: ImportFormat = {
  key: "grouvee-csv",
  label: "grouvee export",
  detect: (text) => hasColumns(text, "name", "shelves", "review"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const name = pick(r, "name");
      if (!name) continue;
      const words = [pick(r, "review title"), htmlToText(pick(r, "review"))].filter(hasWords).join("\n\n");
      const id = pick(r, "id");
      items.push(
        workItem({
          id: `grv-${id || slugTitle(name)}`,
          title: name,
          kind: "game",
          url: id ? `https://www.grouvee.com/games/${id}/` : undefined,
          words,
          rating: starsFromRating(pick(r, "rating")),
          date: parseDate(pick(r, "dates").split(/[,;]/)[0]),
        }),
      );
    }
    return { items, seen: rows.length };
  },
};

/** MyAnimeList's XML export (panel.php?go=export): my_comments carries the person's note. */
export const malXml: ImportFormat = {
  key: "mal-xml",
  label: "myanimelist export",
  detect: (text) => /<myanimelist>/i.test(text.slice(0, 2000)) || /<myinfo>/i.test(text.slice(0, 2000)),
  parse: (text) => {
    const $ = load(text, { xmlMode: true });
    const items: ProviderItem[] = [];
    let seen = 0;
    $("anime, manga").each((_, el) => {
      const e = $(el);
      const isAnime = el.type === "tag" && el.name === "anime";
      const id = e.children(isAnime ? "series_animedb_id" : "manga_mangadb_id").text().trim();
      const title = e.children(isAnime ? "series_title" : "manga_title").text().trim();
      if (!title) return;
      seen += 1;
      const score = e.children("my_score").text().trim();
      const status = e.children("my_status").text().trim();
      items.push(
        workItem({
          id: `mal-${isAnime ? "a" : "m"}-${id || slugTitle(title)}`,
          title,
          kind: "anime",
          url: id ? `https://myanimelist.net/${isAnime ? "anime" : "manga"}/${id}` : undefined,
          words: e.children("my_comments").text().trim(),
          rating: [score && score !== "0" ? `${score}/10` : null, status ? status.toLowerCase() : null].filter(Boolean).join(" · ") || null,
          date: parseDate(e.children("my_finish_date").text().trim().replace(/^0000.*/, "")) ?? parseDate(e.children("my_start_date").text().trim().replace(/^0000.*/, "")),
        }),
      );
    });
    return { items, seen };
  },
};

export const rymCsv: ImportFormat = {
  key: "rym-csv",
  label: "rateyourmusic export",
  detect: (text) => hasColumns(text, "rym album", "title", "rating"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const title = pick(r, "title");
      if (!title) continue;
      const artist = [pick(r, "first name"), pick(r, "last name")].filter(Boolean).join(" ");
      const words = clampText(htmlToText(pick(r, "review")), REVIEW_MAX);
      items.push({
        externalId: `rym-${pick(r, "rym album") || slugTitle(title)}`,
        title: artist ? `${title} — ${artist}` : title,
        url: "",
        words: hasWords(words) ? words : "",
        rating: starsFromRating(Number(pick(r, "rating")) / 2) ?? undefined,
        occurredAt: parseDate(pick(r, "purchase date")) ?? new Date(),
        lookup: { kind: "album", title, author: artist || undefined, year: year(pick(r, "release date")) },
      });
    }
    return { items, seen: rows.length };
  },
};

export const SCREEN_FORMATS = [letterboxdCsv, imdbRatingsCsv, netflixSessionJson, crunchyrollSessionJson, netflixCsv, grouveeCsv, malXml, rymCsv];
