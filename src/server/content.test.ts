import { describe, expect, it, vi } from "vitest";
import { ingestOrStubUrl, ingestUrl } from "@/server/services/content";
import { fetchMetadata } from "@/server/metadata";

vi.mock("@/server/metadata", () => ({
  fetchMetadata: vi.fn().mockResolvedValue({ requiresManualInput: true }),
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
