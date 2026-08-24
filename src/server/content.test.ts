import { describe, expect, it, vi } from "vitest";
import { ingestOrStubUrl, ingestUrl } from "@/server/services/content";
import { fetchMetadata } from "@/server/metadata";
import { cleanContentMetadata } from "@/server/cognition/llm";

vi.mock("@/server/metadata", () => ({
  fetchMetadata: vi.fn().mockResolvedValue({ requiresManualInput: true }),
  scoreContentConfidence: vi.fn().mockReturnValue("thin"),
  sourceSlug: (name: string) => name.toLowerCase().replace(/\s+/g, "-"),
}));

vi.mock("@/server/cognition/llm", () => ({
  cleanContentMetadata: vi.fn().mockResolvedValue(null),
}));

describe("ingestOrStubUrl", () => {
  it("creates a stub content item when metadata fetch/manual path is required", async () => {
    const create = vi.fn().mockResolvedValue({ id: "content_1", title: "youtube.com", description: "https://youtube.com/watch?v=abc" });
    const db = {
      contentItem: {
        findUnique: vi.fn().mockResolvedValue(null),
        create,
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "content_1",
          title: "youtube.com",
          description: "https://youtube.com/watch?v=abc",
          source: null,
          contentType: null,
          topics: [],
        }),
      },
      contentSource: { upsert: vi.fn().mockResolvedValue(null) },
      contentType: { upsert: vi.fn().mockResolvedValue(null) },
      contentItemTopic: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    } as any;

    const result = await ingestOrStubUrl("https://youtube.com/watch?v=abc&utm_source=foo", db);
    expect(create).toHaveBeenCalled();
    expect(result.contentItemId).toBe("content_1");
    expect(result.contentTitle).toBe("youtube.com");
  });
});

describe("ingestUrl", () => {
  it("returns the existing row instead of throwing when the site's canonical URL already exists under a different input URL", async () => {
    // The input URL normalizes to something that doesn't match any existing
    // row, but the page's own declared canonical (og:url / link[rel=canonical])
    // already exists in the DB — e.g. because a preflight request for the
    // same link created it first. The create must not blow up with P2002;
    // it should recover by looking up the row via the resolved canonical URL.
    vi.mocked(fetchMetadata).mockResolvedValueOnce({
      requiresManualInput: false,
      metadata: {
        title: "An Article",
        description: "desc",
        canonicalUrl: "https://example.com/article",
        originalUrl: "https://example.com/article?src=share",
      },
    } as any);

    const existingRow = {
      id: "content_existing",
      title: "An Article",
      description: "desc",
      source: null,
      contentType: null,
      topics: [],
    };

    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-check by raw input URL: miss
      .mockResolvedValueOnce(existingRow); // post-P2002 lookup by canonical URL: hit

    const create = vi.fn().mockRejectedValue({ code: "P2002" });

    const db = {
      contentItem: {
        findUnique,
        create,
        findUniqueOrThrow: vi.fn().mockResolvedValue(existingRow),
      },
      contentSource: { upsert: vi.fn().mockResolvedValue(null) },
      contentType: { upsert: vi.fn().mockResolvedValue(null) },
    } as any;

    const result = await ingestUrl("https://example.com/article?src=share", db);

    expect(create).toHaveBeenCalled();
    expect(result.status).toBe("existing");
    expect("contentItem" in result && result.contentItem?.id).toBe("content_existing");
  });
});

describe("the metadata clean", () => {
  /**
   * Substack puts the post's subtitle in og:description, so the raw scrape of
   * a 12,000-character essay carries a seven-word teaser. When the clean fails
   * (timeout, non-2xx, unparseable JSON — all of which resolve to null), that
   * teaser used to be written into `description` and surfaced verbatim as the
   * whole "about this capture" line.
   */
  it("clears the description rather than standing the raw og:description in for a failed clean", async () => {
    vi.mocked(cleanContentMetadata).mockResolvedValueOnce(null);
    vi.mocked(fetchMetadata).mockResolvedValueOnce({
      requiresManualInput: false,
      metadata: {
        title: "28 slightly rude notes on writing",
        description: "OR: catapulting myself into a pit of tarantulas",
        bodyText: "x".repeat(12000),
        canonicalUrl: "https://example.com/notes",
        originalUrl: "https://example.com/notes",
      },
    } as any);

    const update = vi.fn().mockResolvedValue(null);
    const db = {
      contentItem: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "content_1" }),
        update,
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          id: "content_1",
          title: "28 slightly rude notes on writing",
          description: null,
          source: null,
          contentType: null,
          topics: [],
        }),
      },
      contentSource: { upsert: vi.fn().mockResolvedValue(null) },
      contentType: { upsert: vi.fn().mockResolvedValue(null) },
    } as any;

    const result = await ingestUrl("https://example.com/notes", db);
    await ("cleaned" in result ? result.cleaned : undefined);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ description: null }) }),
    );
  });

  it("re-attempts the clean for an existing row that has body text but no excerpt", async () => {
    vi.mocked(cleanContentMetadata).mockResolvedValueOnce({
      title: "28 slightly rude notes on writing",
      author: null,
      excerpt: "A working writer's notes on why bitterness is the one emotion that cannot be used.",
    } as any);

    const existingRow = {
      id: "content_existing",
      title: "28 slightly rude notes on writing",
      description: null,
      bodyText: "x".repeat(12000),
      authorName: null,
      siteName: "Experimental History",
      canonicalUrl: "https://example.com/notes",
      // Older than the 24h cooldown, so a retry is due.
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      source: null,
      contentType: null,
      topics: [],
    };

    const update = vi.fn().mockResolvedValue(null);
    const db = {
      contentItem: {
        findUnique: vi.fn().mockResolvedValue(existingRow),
        update,
      },
    } as any;

    const result = await ingestUrl("https://example.com/notes", db);
    const cleaned = await ("cleaned" in result ? result.cleaned : undefined);

    expect(cleanContentMetadata).toHaveBeenCalled();
    expect(cleaned?.description).toContain("bitterness");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "content_existing" },
        data: { description: expect.stringContaining("bitterness") },
      }),
    );
  });

  it("leaves an existing row alone when it already has an excerpt", async () => {
    const existingRow = {
      id: "content_existing",
      title: "An Article",
      description: "A real excerpt that the clean already produced.",
      bodyText: "x".repeat(12000),
      canonicalUrl: "https://example.com/article",
      updatedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      source: null,
      contentType: null,
      topics: [],
    };

    const db = {
      contentItem: {
        findUnique: vi.fn().mockResolvedValue(existingRow),
        update: vi.fn().mockResolvedValue(null),
      },
    } as any;

    const result = await ingestUrl("https://example.com/article", db);

    expect("cleaned" in result && result.cleaned).toBeUndefined();
    expect(cleanContentMetadata).not.toHaveBeenCalled();
  });
});
