import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMetadata, parseMetadataFromHtml, scoreContentConfidence } from "@/server/metadata";

describe("scoreContentConfidence", () => {
  it("scores substantive body text as rich", () => {
    expect(scoreContentConfidence({ bodyText: "x".repeat(900) })).toBe("rich");
  });

  it("scores short body or description as partial", () => {
    expect(scoreContentConfidence({ bodyText: "x".repeat(200) })).toBe("partial");
    expect(scoreContentConfidence({ description: "d".repeat(200) })).toBe("partial");
  });

  it("scores title-only content as thin", () => {
    expect(scoreContentConfidence({})).toBe("thin");
    expect(scoreContentConfidence({ bodyText: "tiny", description: "also tiny" })).toBe("thin");
  });
});

describe("JSON-LD extraction", () => {
  it("uses articleBody when the DOM has no readable body", () => {
    const article = "A substantive argument about attention and memory. ".repeat(10);
    const html = `
      <html><head>
        <meta property="og:title" content="Essay" />
        <script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", articleBody: article })}</script>
      </head><body></body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://example.com/essay");
    expect(metadata.bodyText).toContain("substantive argument");
    expect(metadata.bodySource).toBe("jsonld");
  });

  it("falls back to long-form JSON-LD description (podcast show notes)", () => {
    const notes = "In this episode we cover the history of writing systems, from cuneiform to the alphabet, and what each transition did to human memory.";
    const html = `
      <html><head>
        <meta property="og:title" content="Episode 12" />
        <script type="application/ld+json">${JSON.stringify({ "@type": "PodcastEpisode", description: notes })}</script>
      </head><body></body></html>
    `;
    const metadata = parseMetadataFromHtml(html, "https://podcasts.apple.com/us/podcast/x/id1");
    expect(metadata.bodyText).toBe(notes);
    expect(metadata.bodySource).toBe("jsonld");
  });
});

describe("fetchMetadata source extractors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads reddit posts via the public JSON API", async () => {
    const selftext = "The core claim: spaced repetition works because retrieval difficulty strengthens the memory trace. ".repeat(3);
    const redditPayload = [
      {
        data: {
          children: [{
            kind: "t3",
            data: {
              title: "What actually makes spaced repetition work?",
              selftext,
              author: "memorynerd",
              subreddit_name_prefixed: "r/Anki",
              permalink: "/r/Anki/comments/abc/what_actually/",
              created_utc: 1719000000,
            },
          }],
        },
      },
      {
        data: {
          children: [{
            kind: "t1",
            data: { body: "Bjork's desirable difficulties research is the canonical source for this — retrieval effort, not exposure, drives retention.", score: 90 },
          }],
        },
      },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => redditPayload,
    } as Response));

    const result = await fetchMetadata("https://www.reddit.com/r/Anki/comments/abc/what_actually/");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.title).toContain("spaced repetition");
    expect(result.metadata?.bodyText).toContain("retrieval difficulty");
    expect(result.metadata?.bodyText).toContain("Bjork");
    expect(result.metadata?.bodySource).toBe("reddit");
    expect(result.metadata?.sourceName).toBe("r/Anki");
  });

  it("reads tweet text via the twitter oEmbed endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        html: '<blockquote class="twitter-tweet"><p>Compression is understanding: a model that predicts well has, in some sense, understood.</p>&mdash; Someone (@someone)</blockquote>',
        author_name: "Someone",
      }),
    } as Response));

    const result = await fetchMetadata("https://x.com/someone/status/123456");
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.bodyText).toContain("Compression is understanding");
    expect(result.metadata?.sourceDomain).toBe("x.com");
  });
});
