import { afterEach, describe, expect, it, vi } from "vitest";
import { Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { calculateFeedScore } from "@/server/feed-score";
import { fetchMetadata, parseMetadataFromHtml, sourceSlug } from "@/server/metadata";
import { buildIdentitySummary } from "@/server/profile-summary";
import { normalizeRankingOrder } from "@/server/rankings";
import { rankTextMatch } from "@/server/search-ranking";
import { cosineSimilarity, overlappingWeights, scaleSimilarityScore } from "@/server/similarity";
import { normalizeUrl } from "@/server/url";
import { canViewerSeeVisibility } from "@/server/visibility";
import { FEED_WEIGHTS } from "@/server/weights";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("normalizeUrl", () => {
  it("strips tracking params, sorts remaining params, and removes trailing slashes", () => {
    expect(
      normalizeUrl("https://Example.com/articles/hello/?utm_source=newsletter&b=2&a=1#section"),
    ).toBe("https://example.com/articles/hello?a=1&b=2");
  });

  it("normalizes youtube mobile and short urls to a canonical watch url", () => {
    expect(normalizeUrl("https://m.youtube.com/watch?v=abc123&utm_medium=social")).toBe(
      "https://www.youtube.com/watch?v=abc123",
    );
    expect(normalizeUrl("https://youtu.be/xyz789?si=abc")).toBe("https://www.youtube.com/watch?v=xyz789");
  });
});

describe("metadata helpers", () => {
  it("parses metadata from html and normalizes relative assets", () => {
    const metadata = parseMetadataFromHtml(
      `
        <html>
          <head>
            <title>Ignored title</title>
            <link rel="canonical" href="/essays/future-of-reading?utm_source=x" />
            <meta property="og:title" content="Future of Reading" />
            <meta property="og:description" content="A long-form essay." />
            <meta property="og:image" content="/images/cover.png" />
            <meta property="og:site_name" content="Noetic Journal" />
            <meta property="og:type" content="article" />
            <meta name="author" content="Ada Lovelace" />
            <meta property="article:published_time" content="2024-01-02T03:04:05.000Z" />
          </head>
        </html>
      `,
      "https://journal.noetic.app/post?utm_source=feed",
    );

    expect(metadata).toMatchObject({
      title: "Future of Reading",
      description: "A long-form essay.",
      canonicalUrl: "https://journal.noetic.app/essays/future-of-reading",
      originalUrl: "https://journal.noetic.app/post?utm_source=feed",
      imageUrl: "https://journal.noetic.app/images/cover.png",
      siteName: "Noetic Journal",
      authorName: "Ada Lovelace",
      sourceName: "Noetic Journal",
      sourceDomain: "journal.noetic.app",
      contentType: "article",
    });
    expect(metadata.publishedAt?.toISOString()).toBe("2024-01-02T03:04:05.000Z");
  });

  it("fetches youtube metadata from a watch URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: "A Great Lecture",
        author_name: "Dr. Smith",
        thumbnail_url: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
        provider_name: "YouTube",
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://www.youtube.com/watch?v=abc123&feature=share");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123&format=json",
    );
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata).toMatchObject({
      title: "A Great Lecture",
      canonicalUrl: "https://www.youtube.com/watch?v=abc123",
      sourceName: "YouTube",
      sourceDomain: "youtube.com",
      contentType: "video",
    });
  });

  it("fetches youtube metadata from a youtu.be short URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: "A Great Lecture",
        author_name: "Dr. Smith",
        thumbnail_url: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
        provider_name: "YouTube",
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://youtu.be/abc123?si=foo");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123&format=json",
    );
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.canonicalUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(result.metadata?.title).toBe("A Great Lecture");
  });

  it("fetches youtube metadata from a shorts URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        title: "A Great Lecture",
        author_name: "Dr. Smith",
        thumbnail_url: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
        provider_name: "YouTube",
      }),
    } as Response);

    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://www.youtube.com/shorts/abc123?feature=share");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123&format=json",
    );
    expect(result.requiresManualInput).toBe(false);
    expect(result.metadata?.canonicalUrl).toBe("https://www.youtube.com/watch?v=abc123");
    expect(result.metadata?.title).toBe("A Great Lecture");
  });

  it("falls back to manual input when an html fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMetadata("https://example.com/story");

    expect(result).toEqual({ requiresManualInput: true });
  });

  it("creates stable source slugs", () => {
    expect(sourceSlug("The New Yorker")).toBe("the-new-yorker");
  });
});

describe("normalizeRankingOrder", () => {
  it("assigns deterministic positions in the provided order", () => {
    expect(normalizeRankingOrder(["c1", "c2", "c3"])) .toEqual([
      { contentItemId: "c1", position: 1 },
      { contentItemId: "c2", position: 2 },
      { contentItemId: "c3", position: 3 },
    ]);
  });

  it("throws an application error when duplicate items appear", () => {
    expect(() => normalizeRankingOrder(["c1", "c1"])) .toThrowError(AppError);
    expect(() => normalizeRankingOrder(["c1", "c1"])) .toThrowError(/duplicate content items/i);
  });
});

describe("similarity helpers", () => {
  it("computes cosine similarity for weighted vectors", () => {
    expect(cosineSimilarity({ a: 2, b: 1 }, { a: 2, b: 1 })).toBeCloseTo(1);
    expect(cosineSimilarity({ a: 1 }, { b: 1 })).toBe(0);
  });

  it("scales similarity scores to a 0-100 range with two decimals", () => {
    expect(scaleSimilarityScore(0.12345)).toBe(12.35);
    expect(scaleSimilarityScore(2)).toBe(100);
    expect(scaleSimilarityScore(-1)).toBe(0);
  });

  it("sorts overlapping weights by combined score", () => {
    expect(
      overlappingWeights(
        { "topic:philosophy": 4, "topic:fiction": 1, "source:nyt": 2 },
        { "topic:philosophy": 2, "topic:fiction": 6, "topic:history": 1 },
        "topic:",
      ),
    ).toEqual([
      { key: "topic:fiction", score: 7 },
      { key: "topic:philosophy", score: 6 },
    ]);
  });
});

describe("calculateFeedScore", () => {
  it("weights follow, similarity, topic overlap, and recency according to constants", () => {
    expect(
      calculateFeedScore({
        followWeight: 1,
        similarityWeight: 0.5,
        topicOverlap: 0.25,
        recencyDecay: 0.75,
      }),
    ).toBe(
      1 * FEED_WEIGHTS.follow +
        0.5 * FEED_WEIGHTS.similarity +
        0.25 * FEED_WEIGHTS.topicOverlap +
        0.75 * FEED_WEIGHTS.recency,
    );
  });
});

describe("canViewerSeeVisibility", () => {
  it("allows owners to see private content", () => {
    expect(
      canViewerSeeVisibility({
        visibility: Visibility.PRIVATE,
        viewerId: "user_1",
        ownerId: "user_1",
      }),
    ).toBe(true);
  });

  it("allows followers to see followers-only content", () => {
    expect(
      canViewerSeeVisibility({
        visibility: Visibility.FOLLOWERS,
        viewerId: "user_2",
        ownerId: "user_1",
        viewerFollowsOwner: true,
      }),
    ).toBe(true);
  });

  it("blocks strangers from private and followers-only content", () => {
    expect(
      canViewerSeeVisibility({
        visibility: Visibility.FOLLOWERS,
        viewerId: "user_3",
        ownerId: "user_1",
      }),
    ).toBe(false);
    expect(
      canViewerSeeVisibility({
        visibility: Visibility.PRIVATE,
        viewerId: "user_3",
        ownerId: "user_1",
      }),
    ).toBe(false);
  });
});

describe("buildIdentitySummary", () => {
  it("builds a readable summary from populated profile signals", () => {
    expect(
      buildIdentitySummary({
        topTopics: ["Philosophy", "Design"],
        topSources: ["The Paris Review"],
        recentContentTypes: ["article", "podcast"],
      }),
    ).toBe("Top topics: Philosophy, Design. Core sources: The Paris Review. Recent formats: article, podcast.");
  });

  it("falls back to placeholder language when no signals exist", () => {
    expect(
      buildIdentitySummary({
        topTopics: [],
        topSources: [],
        recentContentTypes: [],
      }),
    ).toBe("Top topics: no dominant topics yet. Core sources: no dominant sources yet. Recent formats: no recent content types yet.");
  });
});

describe("rankTextMatch", () => {
  it("prioritizes exact, prefix, include, and miss cases correctly", () => {
    expect(rankTextMatch("Noetic", "Noetic")).toBe(100);
    expect(rankTextMatch("Noetic Journal", "noetic")).toBe(80);
    expect(rankTextMatch("The Noetic Journal", "noetic")).toBe(50);
    expect(rankTextMatch("Archive", "noetic")).toBe(0);
  });
});
