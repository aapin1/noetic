import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseGoodreadsFeed, parseGoodreadsInput } from "./goodreads";
import { parseLetterboxdFeed, parseLetterboxdHandle } from "./letterboxd";
import { groupReadwise, highlightKey, parseReadwiseToken, readwise } from "./readwise";
import { openSecret, sealSecret } from "./secret";
import { clampText, hasWords, htmlToText, starsFromRating } from "./text";
import { anilistItems, parseAnilistHandle } from "./anilist";
import { parseCollectionId, parseRaindropFeed } from "./raindrop";
import { parsePlaylistFeed, parsePlaylistId } from "./youtube";
import { parseTraktHandle, traktItems } from "./trakt";
import { hardcoverItems, parseHardcoverToken } from "./hardcover";
import { parseInstapaperFeed, parseInstapaperXml } from "./instapaper";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

/** The rule the whole feature rests on: only entries with the person's own words become captures. */

describe("text helpers", () => {
  it("strips review HTML into paragraphs", () => {
    expect(htmlToText("<p>One &#039;two&#039;</p><p>Three<br />four</p>")).toBe("One 'two'\n\nThree\nfour");
  });
  it("hasWords needs two alphabetic words", () => {
    expect(hasWords("🔥")).toBe(false);
    expect(hasWords("5/5")).toBe(false);
    expect(hasWords("wow")).toBe(false);
    expect(hasWords("i don’t care!")).toBe(true);
  });
  it("stars", () => {
    expect(starsFromRating("4.5")).toBe("★★★★½");
    expect(starsFromRating("5")).toBe("★★★★★");
    expect(starsFromRating("0")).toBeNull();
    expect(starsFromRating("")).toBeNull();
  });
  it("clamps at a sentence", () => {
    const long = "A sentence. ".repeat(100);
    const out = clampText(long, 200);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith(".…")).toBe(true);
  });
});

describe("letterboxd", () => {
  it("accepts usernames, @names and profile urls", () => {
    expect(parseLetterboxdHandle("dave")).toBe("dave");
    expect(parseLetterboxdHandle("@Dave ")).toBe("dave");
    expect(parseLetterboxdHandle("https://letterboxd.com/dave/films/")).toBe("dave");
    expect(parseLetterboxdHandle("letterboxd.com/dave")).toBe("dave");
    expect(parseLetterboxdHandle("not a user name")).toBeNull();
    expect(parseLetterboxdHandle("")).toBeNull();
  });

  it("keeps only diary entries with review text", () => {
    const feed = parseLetterboxdFeed(fixture("letterboxd-jay.xml"));
    expect(feed.label).toBe("Jay");
    expect(feed.seen).toBe(8); // diary entries; the two lists are not counted
    expect(feed.items).toHaveLength(1);
    const [item] = feed.items;
    expect(item.externalId).toBe("letterboxd-review-1425602988");
    expect(item.title).toBe("Face/Off (1997)");
    expect(item.url).toBe("https://letterboxd.com/jay/film/face-off/3/");
    expect(item.words).toBe("i don’t care if you’re times man of the year!");
    expect(item.rating).toBe("★★★★★ · rewatch");
    expect(item.imageUrl).toMatch(/^https:\/\/a\.ltrbxd\.com\//);
    expect(item.occurredAt.toISOString().slice(0, 10)).toBe("2026-07-31");
  });

  it("drops the spoiler notice and the poster from a review", () => {
    const feed = parseLetterboxdFeed(fixture("letterboxd-brat.xml"));
    expect(feed.seen).toBe(2);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].words).not.toMatch(/spoilers/i);
    expect(feed.items[0].words).toMatch(/^Chris Nolan/);
    expect(feed.items[0].rating).toBeUndefined(); // unrated review
  });
});

describe("goodreads", () => {
  it("accepts ids, profile urls and vanity names", () => {
    expect(parseGoodreadsInput("1")).toEqual({ id: "1" });
    expect(parseGoodreadsInput("https://www.goodreads.com/user/show/1-otis-chandler")).toEqual({ id: "1" });
    expect(parseGoodreadsInput("goodreads.com/otis")).toEqual({ vanity: "otis" });
    expect(parseGoodreadsInput("otis")).toEqual({ vanity: "otis" });
    expect(parseGoodreadsInput("goodreads.com/user/show/")).toBeNull();
    expect(parseGoodreadsInput("a b")).toBeNull();
  });

  it("keeps reviewed books, carries the blurb as context, and the rating for display", () => {
    const feed = parseGoodreadsFeed(fixture("goodreads-otis.xml"));
    expect(feed.label).toBe("Otis");
    expect(feed.seen).toBe(6);
    const reviewed = feed.items;
    expect(reviewed.length).toBeGreaterThan(0);
    expect(reviewed.length).toBeLessThan(6);
    for (const item of reviewed) {
      expect(item.externalId).toMatch(/^goodreads-review-\d+$/);
      expect(item.url).toMatch(/^https:\/\/www\.goodreads\.com\/review\/show\/\d+$/);
      expect(item.words).not.toMatch(/<br/);
      expect(item.author).toBeTruthy();
      expect(item.occurredAt.getTime()).toBeLessThan(Date.now());
    }
    const ballistic = reviewed.find((i) => i.title.startsWith("Ballistic"));
    expect(ballistic?.rating).toBe("★★★★★");
    expect(ballistic?.description).toMatch(/^A Next Big Idea Club/);
    expect(ballistic?.words).toMatch(/^This is the coolest story in sports/);
  });
});

describe("readwise", () => {
  it("token shape", () => {
    expect(parseReadwiseToken("  Token abcdefghijklmnopqrstuvwxyz123456 ")).toBe("abcdefghijklmnopqrstuvwxyz123456");
    expect(parseReadwiseToken("short")).toBeNull();
  });

  const book = (id: number, highlights: { id: number; text: string; note?: string | null }[]) => ({
    user_book_id: id,
    title: `Book ${id}`,
    author: "Someone",
    source_url: null,
    readwise_url: `https://readwise.io/bookreview/${id}`,
    cover_image_url: null,
    category: "books",
    highlights: highlights.map((h) => ({ ...h, note: h.note ?? null, highlighted_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" })),
  });

  it("groups one capture per source, skipping highlights already in the ledger", () => {
    const items = groupReadwise(
      [
        book(1, [
          { id: 10, text: "First passage worth keeping." },
          { id: 11, text: "Second passage.", note: "this is the crux" },
        ]),
        book(2, [{ id: 20, text: "Already synced." }]),
        book(3, [{ id: 30, text: "🔥" }]),
      ],
      new Set([highlightKey(20)]),
    );
    expect(items).toHaveLength(1);
    expect(items[0].externalId).toBe("rw-10,rw-11");
    expect(items[0].quote).toBe("First passage worth keeping.\n\nSecond passage.");
    expect(items[0].words).toBe("this is the crux");
    expect(items[0].url).toBe("https://readwise.io/bookreview/1");
  });
});

describe("readwise fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const page = (results: unknown[], nextPageCursor: string | null) =>
    new Response(JSON.stringify({ count: results.length, nextPageCursor, results }), { status: 200 });
  const bookAt = (id: number, updated: string) => ({
    user_book_id: id,
    title: `Book ${id}`,
    author: null,
    source_url: null,
    readwise_url: null,
    cover_image_url: null,
    category: "books",
    highlights: [{ id: id * 10, text: "A passage worth keeping here.", note: null, highlighted_at: updated, updated_at: updated }],
  });

  it("follows pageCursor, sends updatedAfter with overlap, and advances the cursor to the newest update", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return calls.length === 1
          ? page([bookAt(1, "2026-08-01T00:00:00.000Z")], "next-1")
          : page([bookAt(2, "2026-08-02T00:00:00.000Z")], null);
      }),
    );
    const feed = await readwise.fetchWithLedger({ secret: "t".repeat(24), cursor: "2026-07-01T12:00:00.000Z", alreadySeen: new Set() });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("updatedAfter=2026-07-01T11%3A00%3A00.000Z");
    expect(calls[1]).toContain("pageCursor=next-1");
    expect(feed.items.map((i) => i.title)).toEqual(["Book 1", "Book 2"]);
    expect(feed.seen).toBe(2);
    expect(feed.cursor).toBe("2026-08-02T00:00:00.000Z");
  });

  it("maps 401 to the reconnect sentence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"detail":"Invalid token."}', { status: 401 })));
    await expect(readwise.link("x".repeat(24))).rejects.toMatchObject({ code: "BAD_TOKEN" });
  });
});

describe("secret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("round-trips and rejects tampering", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "a-secret-long-enough-for-tests");
    const sealed = sealSecret("tok_123");
    expect(sealed).not.toContain("tok_123");
    expect(openSecret(sealed)).toBe("tok_123");
    expect(openSecret(sealed.slice(0, -2) + "zz")).toBeNull();
    expect(openSecret("garbage")).toBeNull();
  });
});

describe("anilist", () => {
  it("handles", () => {
    expect(parseAnilistHandle("Kaiser")).toBe("Kaiser");
    expect(parseAnilistHandle("https://anilist.co/user/Kaiser/animelist")).toBe("Kaiser");
    expect(parseAnilistHandle("two words")).toBeNull();
  });
  it("keeps entries with notes, dedupes custom-list repeats, normalises the score", () => {
    const entries = JSON.parse(fixture("anilist-entries.json"));
    const { items, seen } = anilistItems(entries, "anime");
    expect(seen).toBe(5); // 6 raw, one repeated via a custom list
    expect(items).toHaveLength(2); // two real notes; "Crunchy" alone is not a thought
    for (const item of items) {
      expect(item.externalId).toMatch(/^anilist-\d+$/);
      expect(item.url).toMatch(/^https:\/\/anilist\.co\/anime\/\d+$/);
      expect(item.words.length).toBeGreaterThan(0);
      expect(item.description ?? "").not.toMatch(/<br>/);
      expect(item.rating).toMatch(/anime$/);
    }
  });
});

describe("raindrop", () => {
  it("collection ids from every url shape", () => {
    expect(parseCollectionId("44652996")).toBe("44652996");
    expect(parseCollectionId("https://raindrop.io/christytucker/blog-posts-44652996")).toBe("44652996");
    expect(parseCollectionId("https://app.raindrop.io/my/66")).toBe("66");
    expect(parseCollectionId("https://raindrop.io/collection/66")).toBe("66");
    expect(parseCollectionId("https://christytucker.raindrop.page/blog-posts-44652996/feed")).toBe("44652996");
    expect(parseCollectionId("https://raindrop.io/")).toBeNull();
  });
  it("turns each bookmark into a link-mode item with no claimed words", () => {
    const feed = parseRaindropFeed(fixture("raindrop-collection.xml"));
    expect(feed.label).toBeTruthy();
    expect(feed.items).toHaveLength(4);
    for (const item of feed.items) {
      expect(item.mode).toBe("link");
      expect(item.words).toBe("");
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.externalId).toBe(`rd-${item.url}`);
    }
  });
});

describe("youtube", () => {
  it("playlist ids from urls and bare ids", () => {
    expect(parsePlaylistId("https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE")).toBe("PLBCF2DAC6FFB574DE");
    expect(parsePlaylistId("https://youtu.be/abc?list=PL8dPuuaLjXtNlUrzyH5r6jN9ulIgZBpdo&index=2")).toBe("PL8dPuuaLjXtNlUrzyH5r6jN9ulIgZBpdo");
    expect(parsePlaylistId("PLBCF2DAC6FFB574DE")).toBe("PLBCF2DAC6FFB574DE");
    expect(parsePlaylistId("https://www.youtube.com/watch?v=abc")).toBeNull();
  });
  it("parses the atom feed into link-mode items", () => {
    const feed = parsePlaylistFeed(fixture("youtube-playlist.xml"));
    expect(feed.label).toBe("Google Search Stories");
    expect(feed.items).toHaveLength(3);
    expect(feed.items[0]).toMatchObject({ externalId: "yt-GvgqDSnpRQM", url: "https://www.youtube.com/watch?v=GvgqDSnpRQM", mode: "link", title: "Andrew Willis, Skatepark Engineer" });
    expect(feed.items[0].occurredAt.getFullYear()).toBe(2013);
  });
});

describe("trakt", () => {
  it("handles", () => {
    expect(parseTraktHandle("https://trakt.tv/users/sean/")).toBe("sean");
    expect(parseTraktHandle("Sean")).toBe("sean");
    expect(parseTraktHandle("a b")).toBeNull();
  });
  it("turns comments into items, titled per media type, with the rating as display", () => {
    const base = { spoiler: false, review: false, created_at: "2015-04-25T00:14:57.000Z", updated_at: "2015-04-25T00:14:57.000Z" };
    const items = traktItems([
      { type: "movie", movie: { title: "Batman Begins", year: 2005, ids: { trakt: 1 } }, comment: { ...base, id: 267, comment: "Great kickoff to a new Batman trilogy!", user_stats: { rating: 10 } } },
      { type: "episode", show: { title: "Gotham", year: 2014, ids: { trakt: 869 } }, episode: { season: 1, number: 1, title: "Jim Gordon" }, comment: { ...base, id: 229, comment: "Is this the OC?", review: true, user_stats: { rating: null } } },
      { type: "show", show: { title: "X", year: null, ids: { trakt: 2 } }, comment: { ...base, id: 300, comment: "🔥", user_stats: { rating: 9 } } },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ externalId: "trakt-267", title: "Batman Begins (2005)", url: "https://trakt.tv/comments/267", rating: "10/10" });
    expect(items[1]).toMatchObject({ title: "Gotham S01E01 — Jim Gordon", rating: "review" });
    expect(items[0].occurredAt.getFullYear()).toBe(2015);
  });
});

describe("hardcover", () => {
  it("accepts the token with or without the Bearer prefix", () => {
    expect(parseHardcoverToken("Bearer eyJabcdefghijklmnopqrstuvwxyz.abc")).toBe("eyJabcdefghijklmnopqrstuvwxyz.abc");
    expect(parseHardcoverToken("nope")).toBeNull();
  });
  it("keeps reviewed books, prefers review_raw, renders rating as stars", () => {
    const items = hardcoverItems([
      { id: 1, status_id: 3, rating: 4.5, review: "<p>Loved it, truly.</p>", review_raw: "Loved it, truly.", reviewed_at: "2026-02-01T00:00:00Z", last_read_date: "2026-01-20", date_added: null, updated_at: null, book: { id: 9, title: "Piranesi", slug: "piranesi", image: { url: "https://x/y.jpg" }, contributions: [{ author: { name: "Susanna Clarke" } }] } },
      { id: 2, status_id: 3, rating: 5, review: null, review_raw: "", reviewed_at: null, last_read_date: null, date_added: null, updated_at: null, book: { id: 10, title: "Empty", slug: null, image: null, contributions: [] } },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "hc-1", title: "Piranesi", url: "https://hardcover.app/books/piranesi", words: "Loved it, truly.", author: "Susanna Clarke", rating: "★★★★½ · read" });
    expect(items[0].occurredAt.toISOString().slice(0, 10)).toBe("2026-01-20");
  });
});

describe("instapaper", () => {
  it("recognises every section's feed url and nothing else", () => {
    expect(parseInstapaperFeed("https://www.instapaper.com/rss/290081/5sgGshfOLwwLXjHzbz3k1f1FquM")).toEqual({ url: "https://www.instapaper.com/rss/290081/5sgGshfOLwwLXjHzbz3k1f1FquM", section: "unread" });
    expect(parseInstapaperFeed("https://www.instapaper.com/starred/rss/13475/qUh7abcdefgh")?.section).toBe("starred");
    expect(parseInstapaperFeed("https://www.instapaper.com/folder/1084441/rss/290081/8jDjJXOalXHntaj01ezFSB9rA")?.section).toBe("folder 1084441");
    expect(parseInstapaperFeed("https://www.instapaper.com/liked")).toBeNull();
    expect(parseInstapaperFeed("my-secret")).toBeNull();
  });
  it("parses items as link-mode articles", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Instapaper: Starred</title><item><guid>https://www.newyorker.com/a</guid><title>Finishing School | The New Yorker</title><link>https://www.newyorker.com/a</link><description>Shouts &amp; Murmurs…</description><pubDate>Sun, 08 Mar 2026 01:22:15 GMT</pubDate></item></channel></rss>`;
    const feed = parseInstapaperXml(xml);
    expect(feed.label).toBe("Instapaper: Starred");
    expect(feed.items[0]).toMatchObject({ externalId: "ip-https://www.newyorker.com/a", url: "https://www.newyorker.com/a", mode: "link", words: "" });
  });
});
