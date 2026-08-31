import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The onboarding recognition capture: a named work becomes a real first
 * capture. What matters: a resolver hit shapes the content item (page,
 * synopsis, cover), a miss still captures as a bare title, and the person's
 * "why it stuck" line rides along as the reaction.
 */

const captureItem = vi.fn(async (payload: Record<string, unknown>) => ({ id: "cap-1", ...payload }));
const createManualContentItem = vi.fn(async () => ({ id: "content-1" }));
const resolveWork = vi.fn(async (..._args: unknown[]) => null as unknown);

vi.mock("@/server/services/cognition", () => ({ captureItem: (...a: unknown[]) => captureItem(a[0] as Record<string, unknown>) }));
vi.mock("@/server/services/content", () => ({ createManualContentItem: (...a: unknown[]) => createManualContentItem(...(a as [])) }));
vi.mock("@/server/imports/resolve", () => ({ resolveWork: (...a: unknown[]) => resolveWork(...a) }));
vi.mock("@/server/services/admission", () => ({ capturePipeline: { run: (fn: () => Promise<unknown>) => fn() } }));

import { captureRecognizedWork } from "@/server/services/recognize";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("captureRecognizedWork", () => {
  it("captures a resolved work with its page, synopsis, and the words as reaction", async () => {
    resolveWork.mockResolvedValueOnce({
      url: "https://en.wikipedia.org/wiki/Interstellar_(film)",
      title: "Interstellar",
      description: "A 2014 epic science fiction film…",
      imageUrl: "https://upload.wikimedia.org/interstellar.jpg",
      author: "Christopher Nolan",
    });

    const result = await captureRecognizedWork({
      userId: "user-1",
      lookup: { kind: "film", title: "interstellar" },
      words: "I think about the ending monthly.",
    });

    expect(resolveWork).toHaveBeenCalledWith({ kind: "film", title: "interstellar" });
    expect(createManualContentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Interstellar",
        description: "A 2014 epic science fiction film…",
        canonicalUrl: "https://en.wikipedia.org/wiki/Interstellar_(film)",
        siteName: "en.wikipedia.org",
        imageUrl: "https://upload.wikimedia.org/interstellar.jpg",
        authorName: "Christopher Nolan",
        contentType: "film",
        topics: [],
      }),
    );
    expect(captureItem).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        kind: "LINK",
        url: "https://en.wikipedia.org/wiki/Interstellar_(film)",
        contentItemId: "content-1",
        origin: "onboarding",
        reaction: "I think about the ending monthly.",
      }),
    );
    expect(result).toMatchObject({ id: "cap-1" });
  });

  it("still captures on a resolver miss, as words about the bare title", async () => {
    resolveWork.mockResolvedValueOnce(null);

    await captureRecognizedWork({
      userId: "user-1",
      lookup: { kind: "book", title: "An Obscure Zine", author: "A. Nobody" },
    });

    expect(createManualContentItem).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "An Obscure Zine",
        description: undefined,
        canonicalUrl: undefined,
        authorName: "A. Nobody",
        contentType: "book",
      }),
    );
    const payload = captureItem.mock.calls[0][0];
    expect(payload.url).toBeUndefined();
    expect(payload.contentItemId).toBe("content-1");
    expect(payload.reaction).toBeUndefined();
  });

  it("maps the album kind to the music content type and drops empty words", async () => {
    resolveWork.mockResolvedValueOnce({ url: "https://en.wikipedia.org/wiki/OK_Computer", title: "OK Computer" });

    await captureRecognizedWork({
      userId: "user-1",
      lookup: { kind: "album", title: "OK Computer", year: 1997 },
      words: "",
    });

    expect(createManualContentItem).toHaveBeenCalledWith(expect.objectContaining({ contentType: "music" }));
    expect(captureItem.mock.calls[0][0].reaction).toBeUndefined();
  });
});
