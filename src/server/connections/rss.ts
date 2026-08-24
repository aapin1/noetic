import { load } from "cheerio";
import { parseDate } from "./text";

/**
 * The lowest common denominator of RSS 2.0 and Atom, for the many sources
 * whose "API" is a feed of posts: title, link, body HTML, date, id.
 */
export type FeedEntry = {
  id: string;
  title: string;
  link: string;
  html: string;
  date: Date | null;
};

export function parseFeed(xml: string): { title: string | null; entries: FeedEntry[] } {
  const $ = load(xml, { xmlMode: true });
  const isAtom = $("feed").length > 0 && $("rss").length === 0;
  const title = (isAtom ? $("feed > title") : $("channel > title")).first().text().trim() || null;
  const entries: FeedEntry[] = [];

  $(isAtom ? "entry" : "item").each((_, el) => {
    const e = $(el);
    const child = (name: string) => e.children(name.replace(":", "\\:")).first();
    const link = isAtom
      ? child("link").attr("href")?.trim() ?? ""
      : child("link").text().trim();
    const html = isAtom
      ? child("content").text() || child("summary").text()
      : child("content:encoded").text() || child("description").text();
    entries.push({
      id: child(isAtom ? "id" : "guid").text().trim() || link,
      title: child("title").text().trim(),
      link,
      html: html ?? "",
      date: parseDate(child(isAtom ? "published" : "pubDate").text()) ?? parseDate(child("updated").text()),
    });
  });

  return { title, entries };
}
