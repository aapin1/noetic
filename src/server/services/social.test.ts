import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import { getPersonCaptures } from "@/server/services/social";
import type { DbClient } from "@/server/db";

type FollowRow = { followerId: string; followingId: string };
type BlockRow = { blockerId: string; blockedId: string };
type ContentRow = {
  title: string;
  authorName: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
};
type CaptureRow = {
  id: string;
  userId: string;
  kind: string;
  capturedAt: Date;
  userTitle: string | null;
  rawText: string | null;
  caption: string | null;
  contentItem: ContentRow | null;
  // Personal fields the endpoint must never surface — present in the fake row
  // so a leak would be caught by the shape assertions below.
  keyIdea: string | null;
  summary: string | null;
  reaction: string | null;
};

/**
 * In-memory stand-in for the tables getPersonCaptures touches. Mirrors the
 * shape of fakeDb in moderation.test.ts so the two read the same way.
 */
function fakeDb(
  opts: {
    follows?: FollowRow[];
    blocks?: BlockRow[];
    captures?: Partial<CaptureRow>[];
  } = {},
) {
  const follows = opts.follows ?? [];
  const blocks = opts.blocks ?? [];
  const captures: CaptureRow[] = (opts.captures ?? []).map((c, i) => ({
    id: c.id ?? `cap-${i}`,
    userId: c.userId ?? "them",
    kind: c.kind ?? "ARTICLE",
    capturedAt: c.capturedAt ?? new Date(Date.UTC(2026, 0, 1) + i * 60_000),
    userTitle: c.userTitle ?? null,
    rawText: c.rawText ?? null,
    caption: c.caption ?? null,
    contentItem: c.contentItem ?? null,
    keyIdea: c.keyIdea ?? "a private key idea",
    summary: c.summary ?? "a private summary",
    reaction: c.reaction ?? "a private reaction",
  }));

  const db = {
    userBlock: {
      findMany: async ({ where }: { where: { OR: Record<string, string>[] } }) =>
        blocks.filter((b) =>
          where.OR.some((clause) =>
            Object.entries(clause).every(([k, v]) => b[k as keyof BlockRow] === v),
          ),
        ),
    },
    follow: {
      findUnique: async ({
        where,
      }: {
        where: { followerId_followingId: FollowRow };
      }) => {
        const { followerId, followingId } = where.followerId_followingId;
        return (
          follows.find((f) => f.followerId === followerId && f.followingId === followingId) ?? null
        );
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "them"
          ? {
              id: "them",
              profile: {
                handle: "them_handle",
                displayName: "Them",
                avatarUrl: null,
                identitySummary: "reads about maps",
              },
            }
          : null,
    },
    capturedItem: {
      count: async ({ where }: { where: { userId: string } }) =>
        captures.filter((c) => c.userId === where.userId).length,
      findMany: async ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: { userId: string };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        let rows = captures
          .filter((c) => c.userId === where.userId)
          .sort(
            (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime() || (a.id < b.id ? 1 : -1),
          );
        if (cursor) {
          const at = rows.findIndex((r) => r.id === cursor.id);
          rows = at === -1 ? [] : rows.slice(at + (skip ?? 0));
        }
        return rows.slice(0, take);
      },
    },
  };

  return db as unknown as DbClient;
}

const FOLLOWING = { follows: [{ followerId: "me", followingId: "them" }] };

describe("getPersonCaptures", () => {
  it("rejects a viewer who does not follow the target", async () => {
    const db = fakeDb();
    await expect(
      getPersonCaptures({ userId: "me", targetUserId: "them", db }),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND", status: 404 });
  });

  it("rejects when a block exists in either direction, even with a follow edge", async () => {
    for (const block of [
      { blockerId: "me", blockedId: "them" },
      { blockerId: "them", blockedId: "me" },
    ]) {
      const db = fakeDb({ ...FOLLOWING, blocks: [block] });
      await expect(
        getPersonCaptures({ userId: "me", targetUserId: "them", db }),
      ).rejects.toBeInstanceOf(AppError);
    }
  });

  it("returns the person header and content metadata only — no personal insight fields", async () => {
    const db = fakeDb({
      ...FOLLOWING,
      captures: [
        {
          id: "a",
          contentItem: {
            title: "The Map Is Not the Territory",
            authorName: "Alfred Korzybski",
            siteName: "Farnam Street",
            canonicalUrl: "https://fs.blog/map-territory",
          },
        },
      ],
    });

    const res = await getPersonCaptures({ userId: "me", targetUserId: "them", db });

    expect(res.user).toEqual({
      id: "them",
      handle: "them_handle",
      displayName: "Them",
      avatarUrl: null,
      identitySummary: "reads about maps",
    });
    expect(res.captureCount).toBe(1);
    expect(res.captures).toHaveLength(1);

    const cap = res.captures[0]!;
    expect(cap).toEqual({
      id: "a",
      title: "The Map Is Not the Territory",
      kind: "ARTICLE",
      capturedAt: cap.capturedAt,
      author: "Alfred Korzybski",
      source: "Farnam Street",
    });
    // The words-only rule for other people's captures: nothing the pipeline or
    // the owner wrote about the content may cross the wire.
    expect(cap).not.toHaveProperty("keyIdea");
    expect(cap).not.toHaveProperty("summary");
    expect(cap).not.toHaveProperty("reaction");
    expect(cap).not.toHaveProperty("userContext");
  });

  it("prefers userTitle, falls back to raw text, and derives source from the URL host", async () => {
    const db = fakeDb({
      ...FOLLOWING,
      captures: [
        {
          id: "titled",
          userTitle: "My name for it",
          contentItem: { title: "Original", authorName: null, siteName: null, canonicalUrl: null },
        },
        {
          id: "textonly",
          rawText: "  a thought typed by hand  ",
        },
        {
          id: "hostfall",
          contentItem: {
            title: "Deep dive",
            authorName: null,
            siteName: null,
            canonicalUrl: "https://www.example.com/deep-dive?x=1",
          },
        },
      ],
    });

    const res = await getPersonCaptures({ userId: "me", targetUserId: "them", db });
    const byId = new Map(res.captures.map((c) => [c.id, c]));

    expect(byId.get("titled")!.title).toBe("My name for it");
    expect(byId.get("textonly")!.title).toBe("a thought typed by hand");
    expect(byId.get("textonly")!.source).toBeNull();
    expect(byId.get("hostfall")!.source).toBe("example.com");
  });

  it("paginates with a cursor and reports the full capture count", async () => {
    const db = fakeDb({
      ...FOLLOWING,
      captures: Array.from({ length: 45 }, (_, i) => ({ id: `c${String(i).padStart(2, "0")}` })),
    });

    const first = await getPersonCaptures({ userId: "me", targetUserId: "them", db });
    expect(first.captureCount).toBe(45);
    expect(first.captures).toHaveLength(40);
    expect(first.nextCursor).toBe(first.captures[39]!.id);

    const second = await getPersonCaptures({
      userId: "me",
      targetUserId: "them",
      cursor: first.nextCursor!,
      db,
    });
    expect(second.captures).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    // No overlap between pages.
    const firstIds = new Set(first.captures.map((c) => c.id));
    expect(second.captures.every((c) => !firstIds.has(c.id))).toBe(true);
  });
});
