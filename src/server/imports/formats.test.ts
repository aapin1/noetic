import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectFormat, parseImportFile } from "./index";

const fx = (name: string) => readFileSync(path.join(__dirname, "__fixtures__", name));
const text = (name: string) => fx(name).toString("utf8");
const parse = (name: string) => parseImportFile({ text: text(name), filename: name });

/** Every export format: detected by its header, parsed into provider items; words vs bare decided per row. */

describe("books", () => {
  it("goodreads: review + private notes are words; a bare read gets a lookup", () => {
    const r = parse("goodreads.csv");
    expect(r.formats).toEqual(["goodreads export"]);
    expect(r.seen).toBe(2);
    const [blind, ships] = r.items;
    expect(blind).toMatchObject({ externalId: "gr-48484", title: "Blindsight", author: "Peter Watts", url: "https://www.goodreads.com/book/show/48484", rating: "★★★★★ · read" });
    expect(blind.words).toMatch(/^A first-contact novel.*\nStayed with me/s);
    expect(blind.occurredAt.toISOString().slice(0, 10)).toBe("2014-11-10");
    expect(ships.words).toBe("");
    expect(ships.lookup).toMatchObject({ kind: "book", title: "The Long Ships", author: "Frans G. Bengtsson" }); // the resolver finds a readable page; the goodreads link is the fallback
  });
  it("storygraph and librarything", () => {
    const sg = parse("storygraph.csv");
    expect(sg.formats).toEqual(["storygraph export"]);
    expect(sg.items[0]).toMatchObject({ title: "Subprime Attention Crisis", author: "Tim Hwang", rating: "★★★★★ · read" });
    expect(sg.items[0].words).toMatch(/^Short and sharp/);
    expect(sg.items[0].lookup).toMatchObject({ kind: "book", title: "Subprime Attention Crisis" });
    expect(sg.items[1].words).toBe("");
    const lt = parse("librarything.tsv");
    expect(lt.formats).toEqual(["librarything export"]);
    expect(lt.items[0]).toMatchObject({ title: "Dune", author: "Frank Herbert", words: "Still the best worldbuilding I know.", rating: "★★★★★" });
    expect(lt.items[0].occurredAt.toISOString().slice(0, 10)).toBe("2007-04-16");
  });
  it("kindle clippings: highlights + notes grouped per book, bookmarks and duplicates dropped", () => {
    const r = parse("clippings.txt");
    expect(r.formats).toEqual(["kindle clippings"]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ title: "Example Title: The Beginning", author: "John Doe", words: "my own note about the highlight", quote: "This is a highlight text that runs on for a while." });
    expect(r.items[0].occurredAt.getFullYear()).toBe(2020);
  });
});

describe("screen", () => {
  it("letterboxd reviews.csv: review is words, rating + rewatch ride along", () => {
    const r = parse("reviews.csv");
    expect(r.formats).toEqual(["letterboxd export"]);
    expect(r.items[0]).toMatchObject({ title: "Face/Off (1997)", words: "i don’t care if you’re times man of the year!", rating: "★★★★★ · rewatch" });
    expect(r.items[0].lookup).toMatchObject({ kind: "film", title: "Face/Off", year: 1997 });
  });
  it("a whole letterboxd zip: the same film in reviews and diary collapses to one", () => {
    const r = parseImportFile({ bytes: new Uint8Array(fx("letterboxd-export.zip")), filename: "letterboxd-export.zip" });
    expect(r.formats).toEqual(["letterboxd export"]);
    expect(r.items.map((i) => i.title).sort()).toEqual(["Face/Off (1997)", "Heat (1995)"]);
    expect(r.items.find((i) => i.title.startsWith("Face"))?.words).toMatch(/times man/);
    expect(r.skippedFiles).toBe(1); // profile.csv
  });
  it("imdb ratings: tv vs film, url kept, no words", () => {
    const r = parse("ratings.csv");
    expect(r.formats).toEqual(["imdb ratings"]);
    expect(r.items[0]).toMatchObject({ title: "Heat (1995)", url: "https://www.imdb.com/title/tt0113277/", rating: "9/10", words: "" });
    expect(r.items[1].title).toBe("Breaking Bad (2008)");
  });
  it("netflix: episodes collapse to the show", () => {
    const r = parse("NetflixViewingHistory.csv");
    expect(r.formats).toEqual(["netflix viewing activity"]);
    expect(r.seen).toBe(3);
    expect(r.items.map((i) => [i.title, i.lookup?.kind, i.rating])).toEqual([
      ["Breaking Bad", "tv", "2 episodes"],
      ["Heat", "film", undefined],
    ]);
  });
  it("myanimelist xml: my_comments is words", () => {
    const r = parse("mal.xml");
    expect(r.formats).toEqual(["myanimelist export"]);
    expect(r.items[0]).toMatchObject({ title: "Cowboy Bebop", url: "https://myanimelist.net/anime/1", words: "the jazz is the point, not the bounty hunting", rating: "10/10 · completed" });
    expect(r.items[1].words).toBe("");
  });
});

describe("notes & social", () => {
  it("markdown with front matter → a text item titled from the front matter", () => {
    const r = parse("note.md");
    expect(r.formats).toEqual(["notes"]);
    expect(r.items[0]).toMatchObject({ title: "On attention", mode: "text" });
    expect(r.items[0].words).toMatch(/^Attention is the only thing we actually spend\. Everything else is borrowed time\./);
    expect(r.items[0].occurredAt.toISOString().slice(0, 10)).toBe("2026-03-02");
  });
  it("day one, evernote, keep", () => {
    const d1 = parse("Journal.json");
    expect(d1.formats).toEqual(["day one journal"]);
    expect(d1.items).toHaveLength(1); // "🔥" is not words
    expect(d1.items[0]).toMatchObject({ externalId: "d1-ABC123", mode: "text" });
    const en = parse("notes.enex");
    expect(en.items[0]).toMatchObject({ title: "Test note", words: "Hello, this is the body of a note.", mode: "text" });
    expect(en.items[0].occurredAt.getFullYear()).toBe(2013);
    const keep = parse("keep-note.json");
    expect(keep.formats).toEqual(["google keep note"]);
    expect(keep.items[0].words).toMatch(/doesn't have a title/);
  });
  it("twitter archive: own tweets are words, retweets dropped", () => {
    const r = parse("tweets.js");
    expect(r.formats).toEqual(["x / twitter archive"]);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ externalId: "tw-111", url: "https://x.com/i/status/111", mode: "text" });
  });
  it("youtube takeout: history dedupes and drops ads; comments are words", () => {
    const h = parse("watch-history.json");
    expect(h.formats).toEqual(["youtube watch history"]);
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({ url: "https://www.youtube.com/watch?v=GvgqDSnpRQM", title: "Andrew Willis, Skatepark Engineer", mode: "link" });
    const c = parse("comments.csv");
    expect(c.formats).toEqual(["youtube comments"]);
    expect(c.items[0]).toMatchObject({ words: "this is the best thing I watched this year", url: "https://www.youtube.com/watch?v=GvgqDSnpRQM", mode: "text" });
  });
  it("raindrop / instapaper csv: links, with the note as reaction", () => {
    const rd = parse("raindrop.csv");
    expect(rd.formats).toEqual(["raindrop export"]);
    expect(rd.items[0]).toMatchObject({ url: "https://scissortailcs.com/working-with-smes/", words: "Kayleen Holt describes six types of SMEs.", mode: "link" });
    const ip = parse("instapaper.csv");
    expect(ip.formats).toEqual(["instapaper export"]);
    expect(ip.items[0]).toMatchObject({ url: "https://www.newyorker.com/a", words: "", mode: "link" });
    expect(ip.items[0].occurredAt.getFullYear()).toBe(2026);
  });
  it("anything else: a pasted list of links", () => {
    const r = parseImportFile({ text: "https://example.com/a\nhttps://example.com/b" });
    expect(r.formats).toEqual(["links"]);
    expect(r.items).toHaveLength(2);
    expect(detectFormat("just words here").key).toBe("links");
  });
});
