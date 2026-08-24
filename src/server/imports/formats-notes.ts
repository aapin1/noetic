import { load } from "cheerio";
import { clampText, hasWords, htmlToText, parseDate } from "@/server/connections/text";
import type { ProviderItem } from "@/server/connections/types";
import { parseBookmarksHtml, parsePastedText } from "@/server/services/import-parse";
import { hasColumns, pick, slugTitle, tableRecords } from "./table";
import type { ImportFormat } from "./types";

/**
 * Notes, journals, read-later lists, social archives, and YouTube. Notes are
 * the person's own writing (text mode); saved links are kept pages (link
 * mode); a note on a saved link becomes its reaction.
 */

const TEXT_MAX = 8000;
const TITLE_MAX = 80;

function snippet(text: string): string {
  const first = text.split(/\n/).map((l) => l.trim()).find(Boolean) ?? text;
  return first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1).trimEnd()}…` : first;
}

function textItem(id: string, words: string, date: Date | null, title?: string, url?: string): ProviderItem | null {
  const clean = clampText(words.trim(), TEXT_MAX);
  if (!hasWords(clean)) return null;
  return { externalId: id, title: title?.trim() || snippet(clean), url: url ?? "", words: clean, occurredAt: date ?? new Date(), mode: "text" };
}

function linkItem(id: string, url: string, title: string, note: string, date: Date | null): ProviderItem | null {
  if (!/^https?:\/\//i.test(url)) return null;
  const words = clampText(note.trim(), TEXT_MAX);
  return { externalId: id, title: title.trim() || url, url, words: hasWords(words) ? words : "", occurredAt: date ?? new Date(), mode: "link" };
}

// ----------------------------------------------------------------- markdown

/** A markdown or plain-text note (Obsidian, Notion, Bear, anything). Front matter is read for title/date, then dropped. */
export const markdownNote: ImportFormat = {
  key: "markdown",
  label: "notes",
  detect: (_text, name) => /\.(md|markdown|txt)$/i.test(name ?? ""),
  parse: (text, name) => {
    let body = text.replace(/^﻿/, "");
    let title = (name ?? "note").replace(/\.(md|markdown|txt)$/i, "").replace(/\s[0-9a-f]{32}$/, "").split("/").pop() ?? "note";
    let date: Date | null = null;
    const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (fm) {
      body = body.slice(fm[0].length);
      const t = fm[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1];
      const d = fm[1].match(/^(?:created|date|created_at):\s*["']?(.+?)["']?\s*$/m)?.[1];
      if (t) title = t;
      if (d) date = parseDate(d);
    }
    // Notion puts properties as plain "Key: value" lines at the top.
    const h1 = body.match(/^#\s+(.+)$/m)?.[1];
    if (h1 && /^(untitled|note)$/i.test(title)) title = h1;
    body = body.replace(/^#\s+.+\n/, "").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b ?? a);
    const item = textItem(`md-${slugTitle(title)}-${body.length}`, body, date, title);
    return { items: item ? [item] : [], seen: 1 };
  },
};

export const dayOneJson: ImportFormat = {
  key: "dayone-json",
  label: "day one journal",
  detect: (text) => /"entries"\s*:\s*\[/.test(text.slice(0, 4000)) && /"creationDate"/.test(text),
  parse: (text) => {
    const data = JSON.parse(text) as { entries: { uuid: string; creationDate: string; text?: string }[] };
    const items = data.entries.map((e) => textItem(`d1-${e.uuid}`, e.text ?? "", parseDate(e.creationDate))).filter((i): i is ProviderItem => !!i);
    return { items, seen: data.entries.length };
  },
};

export const evernoteEnex: ImportFormat = {
  key: "evernote-enex",
  label: "evernote export",
  detect: (text) => /<en-export/i.test(text.slice(0, 2000)),
  parse: (text) => {
    const $ = load(text, { xmlMode: true });
    const items: ProviderItem[] = [];
    let seen = 0;
    $("note").each((i, el) => {
      seen += 1;
      const e = $(el);
      const title = e.children("title").text().trim();
      const body = htmlToText(e.children("content").text());
      const created = e.children("created").text().trim().replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z");
      const item = textItem(`en-${slugTitle(title) || i}-${body.length}`, body, parseDate(created), title, e.find("source-url").text().trim() || undefined);
      if (item) items.push(item);
    });
    return { items, seen };
  },
};

export const googleKeepJson: ImportFormat = {
  key: "keep-json",
  label: "google keep note",
  detect: (text) => /"textContent"|"listContent"/.test(text.slice(0, 2000)) && /"createdTimestampUsec"/.test(text),
  parse: (text, name) => {
    const n = JSON.parse(text) as { title?: string; textContent?: string; listContent?: { text: string; isChecked?: boolean }[]; createdTimestampUsec?: number; isTrashed?: boolean };
    if (n.isTrashed) return { items: [], seen: 1 };
    const body = n.textContent ?? (n.listContent ?? []).map((l) => `${l.isChecked ? "☑" : "☐"} ${l.text}`).join("\n");
    const item = textItem(`keep-${slugTitle(name ?? n.title ?? "note")}-${body.length}`, body, n.createdTimestampUsec ? new Date(n.createdTimestampUsec / 1000) : null, n.title);
    return { items: item ? [item] : [], seen: 1 };
  },
};

// ------------------------------------------------------------ read-later

export const raindropCsv: ImportFormat = {
  key: "raindrop-csv",
  label: "raindrop export",
  detect: (text) => hasColumns(text, "url", "title", "note") || hasColumns(text, "url", "folder", "excerpt"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const note = [pick(r, "note"), pick(r, "highlights")].filter(hasWords).join("\n\n");
      const item = linkItem(`rdx-${pick(r, "id") || pick(r, "url")}`, pick(r, "url"), pick(r, "title"), note, parseDate(pick(r, "created")));
      if (item) items.push(item);
    }
    return { items, seen: rows.length };
  },
};

export const instapaperCsv: ImportFormat = {
  key: "instapaper-csv",
  label: "instapaper export",
  detect: (text) => hasColumns(text, "url", "title", "selection", "folder"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const ts = pick(r, "timestamp");
      const item = linkItem(`ipx-${pick(r, "url")}`, pick(r, "url"), pick(r, "title"), pick(r, "selection"), ts ? new Date(Number(ts) * (ts.length > 11 ? 1 : 1000)) : null);
      if (item) items.push(item);
    }
    return { items, seen: rows.length };
  },
};

export const pocketCsv: ImportFormat = {
  key: "pocket-csv",
  label: "pocket export",
  detect: (text) => hasColumns(text, "title", "url", "time added"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const ts = pick(r, "time added");
      const item = linkItem(`pkt-${pick(r, "url")}`, pick(r, "url"), pick(r, "title"), "", ts ? new Date(Number(ts) * 1000) : null);
      if (item) items.push(item);
    }
    return { items, seen: rows.length };
  },
};

export const bookmarksHtml: ImportFormat = {
  key: "bookmarks-html",
  label: "browser bookmarks",
  detect: (text, name) => /\.html?$/i.test(name ?? "") || /<!doctype netscape/i.test(text.slice(0, 200)),
  parse: (text) => {
    const $ = load(text);
    const items: ProviderItem[] = [];
    $("a[href]").each((_, a) => {
      const href = $(a).attr("href") ?? "";
      const added = $(a).attr("add_date");
      const item = linkItem(`bm-${href}`, href, $(a).text(), "", added ? new Date(Number(added) * 1000) : null);
      if (item) items.push(item);
    });
    const seen = parseBookmarksHtml(text).length;
    return { items, seen };
  },
};

export const urlList: ImportFormat = {
  key: "links",
  label: "links",
  detect: () => true,
  parse: (text) => {
    const urls = parsePastedText(text);
    const items = urls.map((u) => linkItem(`url-${u}`, u, u, "", null)).filter((i): i is ProviderItem => !!i);
    return { items, seen: urls.length };
  },
};

// ------------------------------------------------------------------ social

/** Twitter/X archive: data/tweet.js (own tweets) and data/like.js (liked, text only). */
export const twitterArchive: ImportFormat = {
  key: "twitter-archive",
  label: "x / twitter archive",
  detect: (text, name) => /(^|\/)(tweets?|like)\.js$/i.test(name ?? "") || /^window\.YTD\.(tweets?|like)\.part\d+\s*=/.test(text.slice(0, 200)),
  parse: (text, name) => {
    const json = text.replace(/^window\.YTD\.\w+\.part\d+\s*=\s*/, "");
    const rows = JSON.parse(json) as ({ tweet?: { id_str: string; full_text: string; created_at: string; in_reply_to_status_id_str?: string } } & { like?: { tweetId: string; fullText?: string } })[];
    const items: ProviderItem[] = [];
    const liked = /like\.js$/i.test(name ?? "") || rows[0]?.like !== undefined;
    for (const r of rows) {
      if (r.tweet) {
        if (r.tweet.in_reply_to_status_id_str || /^RT @/.test(r.tweet.full_text)) continue;
        const item = textItem(`tw-${r.tweet.id_str}`, r.tweet.full_text, parseDate(r.tweet.created_at), undefined, `https://x.com/i/status/${r.tweet.id_str}`);
        if (item) items.push(item);
      } else if (r.like?.fullText) {
        const item = linkItem(`twl-${r.like.tweetId}`, `https://x.com/i/status/${r.like.tweetId}`, snippet(r.like.fullText), "", null);
        if (item) items.push({ ...item, words: "", description: r.like.fullText });
      }
    }
    return { items, seen: rows.length, ...(liked ? {} : {}) };
  },
};

/** Instagram/Threads data download: your_instagram_activity/threads/threads_and_replies.json. */
export const threadsJson: ImportFormat = {
  key: "threads-json",
  label: "threads posts",
  detect: (text, name) => /threads(_and_replies)?\.json$/i.test(name ?? "") || /"text_post_app_text_posts"/.test(text.slice(0, 500)),
  parse: (text) => {
    const data = JSON.parse(text) as { text_post_app_text_posts?: { media?: { title?: string; creation_timestamp?: number }[]; title?: string; creation_timestamp?: number }[] };
    const posts = data.text_post_app_text_posts ?? [];
    const items: ProviderItem[] = [];
    posts.forEach((p, i) => {
      const body = p.title ?? p.media?.[0]?.title ?? "";
      const ts = p.creation_timestamp ?? p.media?.[0]?.creation_timestamp;
      const item = textItem(`th-${ts ?? i}`, body, ts ? new Date(ts * 1000) : null);
      if (item) items.push(item);
    });
    return { items, seen: posts.length };
  },
};

// ----------------------------------------------------------------- youtube

/** Google Takeout: history/watch-history.json — every video becomes a kept page (captions read). */
export const youtubeWatchHistory: ImportFormat = {
  key: "youtube-history",
  label: "youtube watch history",
  detect: (text, name) => /watch-history\.json$/i.test(name ?? "") || (/"titleUrl"\s*:\s*"https:\/\/www\.youtube\.com\/watch/.test(text.slice(0, 3000)) && /"header"\s*:\s*"YouTube/.test(text.slice(0, 3000))),
  parse: (text) => {
    const rows = JSON.parse(text) as { title: string; titleUrl?: string; time: string; header?: string; details?: { name: string }[] }[];
    const items: ProviderItem[] = [];
    const seenIds = new Set<string>();
    for (const r of rows) {
      if (r.details?.some((d) => /ads/i.test(d.name))) continue;
      const id = r.titleUrl?.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1];
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      const item = linkItem(`yth-${id}`, `https://www.youtube.com/watch?v=${id}`, r.title.replace(/^Watched\s+/i, ""), "", parseDate(r.time));
      if (item) items.push(item);
    }
    return { items, seen: rows.length };
  },
};

/** Takeout playlists/*.csv ("Video ID,Playlist Video Creation Timestamp"), including Liked videos.csv; also the in-app sign-in's liked list. */
export const youtubeVideoIdCsv: ImportFormat = {
  key: "youtube-playlist-csv",
  label: "youtube videos",
  detect: (text) => hasColumns(text, "video id"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      const id = pick(r, "video id");
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
      const item = linkItem(`ytp-${id}`, `https://www.youtube.com/watch?v=${id}`, pick(r, "title") || `youtube video ${id}`, "", parseDate(pick(r, "playlist video creation timestamp", "timestamp")));
      if (item) items.push(item);
    }
    return { items, seen: rows.length };
  },
};

/** Takeout comments/comments.csv — the person's words, under the video they were left on. */
export const youtubeCommentsCsv: ImportFormat = {
  key: "youtube-comments",
  label: "youtube comments",
  detect: (text) => hasColumns(text, "comment id", "comment text"),
  parse: (text) => {
    const { rows } = tableRecords(text);
    const items: ProviderItem[] = [];
    for (const r of rows) {
      let body = pick(r, "comment text");
      try {
        const parsed = JSON.parse(body) as { text?: string }[] | { takeoutSegments?: { text?: string }[] };
        const segs = Array.isArray(parsed) ? parsed : parsed.takeoutSegments ?? [];
        body = segs.map((s) => s.text ?? "").join("");
      } catch {
        /* plain text */
      }
      const videoId = pick(r, "video id");
      const item = textItem(`ytc-${pick(r, "comment id")}`, body, parseDate(pick(r, "comment create timestamp")), undefined, videoId ? `https://www.youtube.com/watch?v=${videoId}` : undefined);
      if (item) items.push(item);
    }
    return { items, seen: rows.length };
  },
};

export const NOTE_FORMATS = [
  dayOneJson,
  evernoteEnex,
  googleKeepJson,
  threadsJson,
  twitterArchive,
  youtubeWatchHistory,
  youtubeCommentsCsv,
  youtubeVideoIdCsv,
  raindropCsv,
  instapaperCsv,
  pocketCsv,
  markdownNote,
  bookmarksHtml,
];
/** Last resort — anything with links in it. */
export const FALLBACK_FORMAT = urlList;
