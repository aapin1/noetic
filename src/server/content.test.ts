import { describe, expect, it, vi } from "vitest";
import { ingestOrStubUrl } from "@/server/services/content";

vi.mock("@/server/metadata", () => ({
  fetchMetadata: vi.fn().mockResolvedValue({ requiresManualInput: true }),
  sourceSlug: (name: string) => name.toLowerCase().replace(/\s+/g, "-"),
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
