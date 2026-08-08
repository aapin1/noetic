import { describe, expect, it } from "vitest";
import {
  detectImportFormat,
  parseBookmarksHtml,
  parseImportContent,
  parsePastedText,
  parsePocketCsv,
  planImport,
} from "@/server/services/import-parse";

describe("parsePastedText", () => {
  it("pulls urls out of prose, lists, and bare www lines", () => {
    const text = [
      "check out https://example.com/a and http://example.com/b.",
      "https://example.com/c",
      "www.example.com/d",
      "not a url at all",
    ].join("\n");

    expect(parsePastedText(text)).toEqual([
      "https://example.com/a",
      "http://example.com/b",
      "https://example.com/c",
      "https://www.example.com/d",
    ]);
  });

  it("strips trailing punctuation but keeps path punctuation", () => {
    expect(parsePastedText("see (https://example.com/a?x=1).")).toEqual([
      "https://example.com/a?x=1",
    ]);
  });

  it("returns nothing for linkless text", () => {
    expect(parsePastedText("just some thoughts, no links")).toEqual([]);
  });
});

describe("parseBookmarksHtml", () => {
  const netscape = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<DL><p>
  <DT><A HREF="https://example.com/one" ADD_DATE="1690000000">One</A>
  <DT><A HREF='https://example.com/two' ICON="data:image/png;base64,x">Two</A>
  <DT><A HREF="javascript:void(0)">Not a link</A>
  <DT><A NAME="anchor-without-href">Nothing</A>
</DL><p>`;

  it("takes every http(s) anchor href from a netscape file", () => {
    expect(parseBookmarksHtml(netscape)).toEqual([
      "https://example.com/one",
      "https://example.com/two",
    ]);
  });

  it("survives malformed html without throwing", () => {
    expect(parseBookmarksHtml("<a href=https://no-quotes.example.com><dl><dt<<")).toEqual([]);
  });
});

describe("parsePocketCsv", () => {
  it("reads the url column of a pocket export", () => {
    const csv = [
      "title,url,time_added,tags,status",
      '"A title, with a comma",https://example.com/one,1690000000,,unread',
      '"quoted ""inner"" title",https://example.com/two,1690000001,tag,archive',
    ].join("\n");

    expect(parsePocketCsv(csv)).toEqual(["https://example.com/one", "https://example.com/two"]);
  });

  it("falls back to scanning cells when there is no header", () => {
    const csv = "Something,https://example.com/one\nOther,https://example.com/two";
    expect(parsePocketCsv(csv)).toEqual(["https://example.com/one", "https://example.com/two"]);
  });

  it("skips malformed rows instead of failing the file", () => {
    const csv = "title,url\nrow-with-no-url-column\ngood,https://example.com/kept";
    expect(parsePocketCsv(csv)).toEqual(["https://example.com/kept"]);
  });

  it("handles an empty file", () => {
    expect(parsePocketCsv("")).toEqual([]);
  });
});

describe("detectImportFormat", () => {
  it("trusts the filename first", () => {
    expect(detectImportFormat("anything", "bookmarks.html")).toBe("bookmarks-html");
    expect(detectImportFormat("anything", "ril_export.csv")).toBe("pocket-csv");
  });

  it("sniffs content when there is no filename", () => {
    expect(detectImportFormat("<!DOCTYPE NETSCAPE-Bookmark-file-1><DL>")).toBe("bookmarks-html");
    expect(detectImportFormat("title,url,time_added\nfoo,https://x.example,1")).toBe("pocket-csv");
    expect(detectImportFormat("https://example.com/a\nhttps://example.com/b")).toBe("text");
  });

  it("routes through parseImportContent end to end", () => {
    expect(parseImportContent("title,url\nfoo,https://example.com/a", "export.csv")).toEqual([
      "https://example.com/a",
    ]);
  });
});

describe("planImport", () => {
  it("dedupes within the batch after normalization", () => {
    const plan = planImport({
      urls: [
        "https://example.com/a",
        "https://EXAMPLE.com/a#fragment",
        "https://example.com/a?utm_source=x",
      ],
      existing: new Set(),
    });

    expect(plan.toCapture).toEqual(["https://example.com/a"]);
    expect(plan.duplicates).toBe(2);
  });

  it("dedupes against captures the user already has", () => {
    const plan = planImport({
      urls: ["https://example.com/old", "https://example.com/new"],
      existing: new Set(["https://example.com/old"]),
    });

    expect(plan.toCapture).toEqual(["https://example.com/new"]);
    expect(plan.duplicates).toBe(1);
  });

  it("counts unparseable tokens as invalid, never fatal", () => {
    const plan = planImport({
      urls: ["https://example.com/ok", "::::not-a-url::::"],
      existing: new Set(),
    });

    expect(plan.toCapture).toEqual(["https://example.com/ok"]);
    expect(plan.invalid).toBe(1);
  });

  it("caps the batch and counts the overflow", () => {
    const urls = Array.from({ length: 205 }, (_, i) => `https://example.com/page-${i}`);
    const plan = planImport({ urls, existing: new Set() });

    expect(plan.toCapture).toHaveLength(200);
    expect(plan.overCap).toBe(5);
  });

  it("handles an empty batch", () => {
    expect(planImport({ urls: [], existing: new Set() })).toEqual({
      toCapture: [],
      duplicates: 0,
      invalid: 0,
      overCap: 0,
    });
  });
});
