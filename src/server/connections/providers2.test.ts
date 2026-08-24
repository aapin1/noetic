import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { arenaItems, parseArenaSlug, parseGithubUser, parsePinboardInput, parseZoteroInput, zoteroItems } from "./collections";
import { kitsuItems, parseBackloggdReviews, parseBackloggdUser, parseKitsuHandle, parseRawgUser, parseSteamInput, parseSteamReviews } from "./games-anime";
import { bandcampItems, listenbrainzItems, parseBandcampFan, parseListenbrainzUser } from "./music";
import { parseFeed } from "./rss";
import { parseBlueskyHandle, parseBookwyrmHandle, parseFediverseHandle, parseMediumUser, parseRedditUser, parseSubstackPub, parseTumblrBlog } from "./writing";

const fixture = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");

/** Second wave of providers: places people write, keep, play. All fixtures are live responses from 2026-08-23. */

describe("feed parser", () => {
  it("reads mastodon's rss (post html in description)", () => {
    const feed = parseFeed(fixture("mastodon-gargron.xml"));
    expect(feed.title).toBe("Eugen Rochko");
    expect(feed.entries.length).toBe(20);
    expect(feed.entries[0].link).toMatch(/^https:\/\/mastodon\.social\/@Gargron\/\d+/);
    expect(feed.entries[0].html.length).toBeGreaterThan(0);
    expect(feed.entries[0].date).toBeInstanceOf(Date);
  });
  it("reads medium's rss (content:encoded)", () => {
    const feed = parseFeed(fixture("medium-ev.xml"));
    expect(feed.entries.length).toBe(10);
    expect(feed.entries[0].html).toMatch(/<p|<h/);
    expect(feed.entries[0].link).toMatch(/medium\.com\//);
  });
  it("reads tumblr and bookwyrm", () => {
    expect(parseFeed(fixture("tumblr-staff.xml")).entries.length).toBe(20);
    const bw = parseFeed(fixture("bookwyrm-mouse.xml"));
    expect(bw.entries.length).toBe(10);
    expect(bw.entries[0].link).toMatch(/bookwyrm\.social/);
  });
});

describe("handles", () => {
  it("fediverse", () => {
    expect(parseFediverseHandle("@Gargron@mastodon.social")).toEqual({ user: "Gargron", instance: "mastodon.social" });
    expect(parseFediverseHandle("https://mastodon.social/@Gargron")).toEqual({ user: "Gargron", instance: "mastodon.social" });
    expect(parseFediverseHandle("gargron")).toBeNull();
    expect(parseBookwyrmHandle("https://bookwyrm.social/user/mouse")).toEqual({ user: "mouse", instance: "bookwyrm.social" });
  });
  it("bluesky", () => {
    expect(parseBlueskyHandle("@jay.bsky.team")).toBe("jay.bsky.team");
    expect(parseBlueskyHandle("https://bsky.app/profile/bsky.app")).toBe("bsky.app");
    expect(parseBlueskyHandle("someone")).toBe("someone.bsky.social");
  });
  it("tumblr / medium / substack / reddit", () => {
    expect(parseTumblrBlog("https://staff.tumblr.com/")).toBe("staff");
    expect(parseMediumUser("https://medium.com/@ev")).toBe("ev");
    expect(parseSubstackPub("https://on.substack.com/p/hello")).toBe("on.substack.com");
    expect(parseSubstackPub("newsletter.example.com")).toBe("newsletter.example.com");
    expect(parseSubstackPub("mine")).toBe("mine.substack.com");
    expect(parseRedditUser("u/spez")).toBe("spez");
    expect(parseRedditUser("https://www.reddit.com/user/spez/")).toBe("spez");
  });
  it("collections", () => {
    expect(parsePinboardInput("jm")).toEqual({ user: "jm" });
    expect(parsePinboardInput("jm:A1B2C3D4E5F6A1B2C3D4")).toEqual({ token: "jm:A1B2C3D4E5F6A1B2C3D4" });
    expect(parseArenaSlug("https://www.are.na/charles-broskoski/channels")).toBe("charles-broskoski");
    expect(parseZoteroInput("475425")).toEqual({ userId: "475425" });
    expect(parseZoteroInput("abcdefghijklmnopqrstuvwx")).toEqual({ apiKey: "abcdefghijklmnopqrstuvwx" });
    expect(parseGithubUser("https://github.com/torvalds")).toBe("torvalds");
  });
  it("games / anime / music", () => {
    expect(parseKitsuHandle("https://kitsu.app/users/josh")).toBe("josh");
    expect(parseSteamInput("https://steamcommunity.com/id/robinwalker/")).toEqual({ path: "id/robinwalker" });
    expect(parseSteamInput("76561197960435530")).toEqual({ path: "profiles/76561197960435530" });
    expect(parseBackloggdUser("https://backloggd.com/u/Jordan/")).toBe("Jordan");
    expect(parseRawgUser("rawg.io/@someone")).toBe("someone");
    expect(parseListenbrainzUser("https://listenbrainz.org/user/rob/")).toBe("rob");
    expect(parseBandcampFan("https://bandcamp.com/knightnite")).toBe("knightnite");
  });
});

describe("collections", () => {
  it("are.na: text blocks are the person's words, links are kept pages", () => {
    const data = JSON.parse(fixture("arena-contents.json")) as { data: Parameters<typeof arenaItems>[0] };
    const items = arenaItems(data.data);
    for (const i of items) {
      expect(["text", "link"]).toContain(i.mode);
      expect(i.url).toMatch(/^https?:\/\//);
    }
  });
  it("zotero: a note on a paper becomes the person's words about that paper", () => {
    const items = zoteroItems([
      { key: "P1", data: { itemType: "journalArticle", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" } },
      { key: "A1", data: { itemType: "attachment", parentItem: "P1" } },
      { key: "N1", data: { itemType: "note", parentItem: "P1", note: "<p>The key idea is dropping recurrence entirely.</p>", dateModified: "2026-01-01T00:00:00Z" } },
      { key: "X1", data: { itemType: "annotation", parentItem: "A1", annotationText: "multi-head attention", annotationComment: "this is the crux", dateModified: "2026-01-02T00:00:00Z" } },
      { key: "E1", data: { itemType: "note", note: "<p>🔥</p>" } },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ externalId: "zot-N1", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", mode: "text", words: "The key idea is dropping recurrence entirely." });
    expect(items[1]).toMatchObject({ externalId: "zot-X1", title: "Attention Is All You Need", mode: "words", quote: "multi-head attention" });
  });
});

describe("games, anime, music", () => {
  it("steam: review boxes → reviews with verdict and hours", () => {
    const feed = parseSteamReviews(fixture("steam-reviews.html"), "id/robinwalker");
    expect(feed.seen).toBeGreaterThanOrEqual(1);
    expect(feed.items.length).toBeGreaterThanOrEqual(1);
    expect(feed.items[0]).toMatchObject({ externalId: "steam-365360", url: "https://steamcommunity.com/id/robinwalker/recommended/365360/", words: "The best of all things." });
    expect(feed.items[0].rating).toMatch(/^Recommended · .*hrs on record$/);
    expect(feed.items[0].occurredAt.getFullYear()).toBe(2017);
  });
  it("backloggd: game-name row + review card", () => {
    const feed = parseBackloggdReviews(fixture("backloggd-reviews.html"), "Jordan");
    expect(feed.seen).toBe(1);
    expect(feed.items[0]).toMatchObject({ externalId: "bl-314748", title: "EarthBound (1994)", url: "https://backloggd.com/u/Jordan/review/314748/" });
    expect(feed.items[0].words).toMatch(/^After multiple attempts/);
    expect(feed.items[0].rating).toContain("Abandoned");
    expect(feed.items[0].occurredAt.toISOString().slice(0, 10)).toBe("2022-02-08");
  });
  it("kitsu: reviews carry the media title and synopsis", () => {
    const data = JSON.parse(fixture("kitsu-reviews.json")) as { data: Parameters<typeof kitsuItems>[2]; included: Parameters<typeof kitsuItems>[1] };
    const items = kitsuItems([], data.included, data.data);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].url).toMatch(/^https:\/\/kitsu\.app\/(anime|manga)\/[^/]+\/reviews\/\d+$/);
    expect(items[0].words.length).toBeGreaterThan(50);
    expect(items[0].rating).toMatch(/review$/);
  });
  it("listenbrainz: pins with a blurb", () => {
    const data = JSON.parse(fixture("listenbrainz-pins.json")) as { pinned_recordings: Parameters<typeof listenbrainzItems>[0] };
    const items = listenbrainzItems(data.pinned_recordings);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toMatch(/ — /);
    expect(items[0].words).toMatch(/\w+ \w+/);
  });
  it("bandcamp: every purchase is a kept page; 'why' is the person's words", () => {
    const data = JSON.parse(fixture("bandcamp-collection.json")) as { items: Parameters<typeof bandcampItems>[0] };
    const items = bandcampItems(data.items);
    expect(items.length).toBe(data.items.length);
    expect(items[0]).toMatchObject({ mode: "link", title: "Never-Ending Holocaust — Mass Extinction" });
    expect(items[0].url).toMatch(/bandcamp\.com\/album\//);
  });
});
