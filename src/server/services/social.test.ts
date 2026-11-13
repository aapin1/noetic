import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import { getPersonCapture, getPersonCaptures, getPersonFollows, getPersonWrapped } from "@/server/services/social";
import type { DbClient } from "@/server/db";

type FollowRow = { followerId: string; followingId: string };
type BlockRow = { blockerId: string; blockedId: string };
type ContentRow = {
  title: string;
  authorName: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
  description?: string | null;
  imageUrl?: string | null;
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
  contentItemId: string | null;
  mediaUrl: string | null;
  topics: string[];
  // Personal fields the endpoint must never surface — present in the fake row
  // so a leak would be caught by the shape assertions below.
  keyIdea: string | null;
  summary: string | null;
  reaction: string | null;
  userContext: string | null;
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
    tzOffsets?: Record<string, number>;
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
    contentItemId: c.contentItemId ?? null,
    mediaUrl: c.mediaUrl ?? null,
    topics: c.topics ?? [],
    keyIdea: c.keyIdea ?? "a private key idea",
    summary: c.summary ?? "a private summary",
    reaction: c.reaction ?? "a private reaction",
    userContext: c.userContext ?? "a private note on what it was about",
  }));
  const topicRows = (row: CaptureRow) =>
    row.topics.map((name) => ({ topic: { id: `t-${name}`, name } }));

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
      count: async ({ where }: { where: Partial<FollowRow> }) =>
        follows.filter((f) =>
          Object.entries(where).every(([k, v]) => f[k as keyof FollowRow] === v),
        ).length,
      // Handles the two shapes the service asks for: one side pinned with the
      // other side `notIn` the hidden list, or the viewer's follows `in` a page.
      findMany: async ({ where }: { where: Record<string, string | { in?: string[]; notIn?: string[] }> }) => {
        const matches = (f: FollowRow) =>
          Object.entries(where).every(([k, v]) => {
            const value = f[k as keyof FollowRow];
            if (typeof v === "string") return value === v;
            if (v.in) return v.in.includes(value);
            if (v.notIn) return !v.notIn.includes(value);
            return true;
          });
        const person = (id: string) => ({
          id,
          profile: { handle: `${id}_handle`, displayName: id, avatarUrl: null },
        });
        return follows
          .map((f, i) => ({ ...f, idx: i }))
          .filter(matches)
          .reverse() // newest first, as createdAt desc
          .map((f) => ({
            id: `f${f.idx}`,
            followingId: f.followingId,
            follower: person(f.followerId),
            following: person(f.followingId),
          }));
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
    userPreference: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        opts.tzOffsets && where.userId in opts.tzOffsets
          ? { tzOffsetMinutes: opts.tzOffsets[where.userId], streakFrozenDays: [] }
          : null,
    },
    capturedItemTopic: {
      findMany: async ({ where }: { where: { capturedItem: { userId: string } } }) =>
        captures
          .filter((c) => c.userId === where.capturedItem.userId)
          .flatMap(topicRows),
    },
    capturedItem: {
      // Returns the whole fake row, personal fields included, so a leak in the
      // service's mapping would show up in the shape assertions.
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = captures.find((c) => c.id === where.id);
        return row ? { ...row, topics: topicRows(row) } : null;
      },
      count: async ({ where }: { where: { userId: string } }) =>
        captures.filter((c) => c.userId === where.userId).length,
      findMany: async ({
        where,
        take,
        cursor,
        skip,
        orderBy,
      }: {
        where: { userId: string; contentItemId?: { not: null } };
        take?: number;
        cursor?: { id: string };
        skip?: number;
        orderBy?: { capturedAt: "asc" | "desc" } | unknown[];
      }) => {
        const asc = !Array.isArray(orderBy) && (orderBy as { capturedAt?: string })?.capturedAt === "asc";
        let rows = captures
          .filter((c) => c.userId === where.userId)
          .filter((c) => !where.contentItemId || c.contentItemId !== null)
          .sort(
            (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime() || (a.id < b.id ? 1 : -1),
          )
          .map((c) => ({ ...c, topics: topicRows(c) }));
        if (asc) rows = rows.reverse();
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
    expect(res.followerCount).toBe(1);
    expect(res.followingCount).toBe(0);
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

describe("getPersonCapture", () => {
  const ARTICLE = {
    id: "a",
    kind: "LINK",
    contentItemId: "content-a",
    topics: ["philosophy", "stoicism"],
    contentItem: {
      title: "On the Shortness of Life",
      authorName: "Seneca",
      siteName: null,
      canonicalUrl: "https://www.example.com/shortness",
      description: "Life is long if you know how to use it.",
      imageUrl: "https://img.example.com/cover.jpg",
    },
  };

  it("rejects a viewer who does not follow the owner", async () => {
    const db = fakeDb({ captures: [ARTICLE] });
    await expect(
      getPersonCapture({ userId: "me", targetUserId: "them", captureId: "a", db }),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND", status: 404 });
  });

  it("refuses a capture that belongs to someone else under this person's URL", async () => {
    const db = fakeDb({ ...FOLLOWING, captures: [{ ...ARTICLE, userId: "stranger" }] });
    await expect(
      getPersonCapture({ userId: "me", targetUserId: "them", captureId: "a", db }),
    ).rejects.toMatchObject({ code: "CAPTURE_NOT_FOUND", status: 404 });
  });

  it("returns the content and nothing the owner or the pipeline wrote about it", async () => {
    const db = fakeDb({ ...FOLLOWING, captures: [ARTICLE] });
    const res = await getPersonCapture({ userId: "me", targetUserId: "them", captureId: "a", db });

    expect(res).toEqual({
      id: "a",
      kind: "LINK",
      title: "On the Shortness of Life",
      capturedAt: res.capturedAt,
      author: "Seneca",
      source: "example.com",
      url: "https://www.example.com/shortness",
      imageUrl: "https://img.example.com/cover.jpg",
      excerpt: "Life is long if you know how to use it.",
      quote: null,
      topics: [
        { id: "t-philosophy", name: "philosophy", kind: "general" },
        { id: "t-stoicism", name: "stoicism", kind: "specific" },
      ],
    });
    const wire = JSON.stringify(res);
    for (const secret of ["private key idea", "private summary", "private reaction", "private note"]) {
      expect(wire).not.toContain(secret);
    }
  });

  it("drops a description that is a scraped body or a bare URL", async () => {
    for (const description of ["x".repeat(401), "https://example.com/paywalled"]) {
      const db = fakeDb({
        ...FOLLOWING,
        captures: [{ ...ARTICLE, contentItem: { ...ARTICLE.contentItem, description } }],
      });
      const res = await getPersonCapture({ userId: "me", targetUserId: "them", captureId: "a", db });
      expect(res.excerpt).toBeNull();
    }
  });

  it("shows a quote's text but keeps a typed note's body to its title", async () => {
    const note = "x ".repeat(60) + "the rest of my private thought";
    const db = fakeDb({
      ...FOLLOWING,
      captures: [
        { id: "q", kind: "QUOTE", rawText: "The obstacle is the way." },
        { id: "n", kind: "TEXT", rawText: note },
      ],
    });
    const quote = await getPersonCapture({ userId: "me", targetUserId: "them", captureId: "q", db });
    expect(quote.quote).toBe("The obstacle is the way.");

    const typed = await getPersonCapture({ userId: "me", targetUserId: "them", captureId: "n", db });
    expect(typed.quote).toBeNull();
    expect(JSON.stringify(typed)).not.toContain("the rest of my private thought");
  });

  it("uses an image capture's own upload as its cover", async () => {
    const db = fakeDb({
      ...FOLLOWING,
      captures: [{ id: "i", kind: "IMAGE", mediaUrl: "https://cdn.example.com/up.jpg", caption: "a sketch" }],
    });
    const res = await getPersonCapture({ userId: "me", targetUserId: "them", captureId: "i", db });
    expect(res.imageUrl).toBe("https://cdn.example.com/up.jpg");
    expect(res.title).toBe("a sketch");
  });
});

describe("getPersonWrapped", () => {
  it("rejects a viewer who does not follow the target", async () => {
    await expect(
      getPersonWrapped({ userId: "me", targetUserId: "them", db: fakeDb() }),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND", status: 404 });
  });

  it("reads the rhythm on the person's own clock", async () => {
    // 05:00 UTC is 1am for someone four hours behind.
    const at = new Date(Date.UTC(2026, 0, 5, 5, 0));
    const db = fakeDb({
      ...FOLLOWING,
      tzOffsets: { them: -240 },
      captures: [{ id: "c1", capturedAt: at }],
    });
    const res = await getPersonWrapped({ userId: "me", targetUserId: "them", db });
    expect(res.busiestHour).toBe(1);
  });

  it("returns only identity cards — no streaks, arcs or social graph", async () => {
    const db = fakeDb({ ...FOLLOWING, captures: [{ id: "c1", topics: ["stoicism"] }] });
    const res = await getPersonWrapped({ userId: "me", targetUserId: "them", db });
    for (const key of ["currentStreak", "longestStreak", "arcs", "followerCount", "friendActivity"]) {
      expect(res).not.toHaveProperty(key);
    }
    expect(res.topTopics).toEqual([{ name: "stoicism", count: 1 }]);
  });

  it("ranks shared ground: specific topics before fields, then by the smaller side", async () => {
    const db = fakeDb({
      ...FOLLOWING,
      captures: [
        { id: "t1", userId: "them", topics: ["philosophy", "stoicism", "chess"] },
        { id: "t2", userId: "them", topics: ["philosophy", "stoicism", "chess"] },
        { id: "t3", userId: "them", topics: ["jazz"] },
        { id: "m1", userId: "me", topics: ["philosophy", "stoicism", "chess"] },
        { id: "m2", userId: "me", topics: ["stoicism"] },
      ],
    });
    const res = await getPersonWrapped({ userId: "me", targetUserId: "them", db });
    expect(res.overlap.topics).toEqual(["stoicism", "chess", "philosophy"]);
  });

  it("lists things you have both saved, once each, linking to their capture", async () => {
    const db = fakeDb({
      ...FOLLOWING,
      captures: [
        { id: "theirs", userId: "them", contentItemId: "shared", contentItem: { title: "Meditations", authorName: null, siteName: null, canonicalUrl: null } },
        { id: "theirs-again", userId: "them", contentItemId: "shared", contentItem: { title: "Meditations", authorName: null, siteName: null, canonicalUrl: null } },
        { id: "only-theirs", userId: "them", contentItemId: "solo", contentItem: { title: "Solo", authorName: null, siteName: null, canonicalUrl: null } },
        { id: "mine", userId: "me", contentItemId: "shared" },
      ],
    });
    const res = await getPersonWrapped({ userId: "me", targetUserId: "them", db });
    expect(res.overlap.saveCount).toBe(1);
    expect(res.overlap.saves).toHaveLength(1);
    expect(res.overlap.saves[0]!.title).toBe("Meditations");
  });
});

describe("getPersonFollows", () => {
  const GRAPH = {
    follows: [
      { followerId: "me", followingId: "them" },
      { followerId: "them", followingId: "ada" },
      { followerId: "them", followingId: "bo" },
      { followerId: "them", followingId: "me" },
      { followerId: "me", followingId: "ada" },
      { followerId: "cy", followingId: "them" },
    ],
  };

  it("rejects a viewer who does not follow the target", async () => {
    const db = fakeDb({ follows: [{ followerId: "them", followingId: "me" }] });
    await expect(
      getPersonFollows({ userId: "me", targetUserId: "them", list: "following", db }),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND", status: 404 });
  });

  it("lists who they follow, marking who the viewer follows and the viewer themself", async () => {
    const res = await getPersonFollows({
      userId: "me",
      targetUserId: "them",
      list: "following",
      db: fakeDb(GRAPH),
    });
    const byId = new Map(res.users.map((u) => [u.id, u]));
    expect([...byId.keys()].sort()).toEqual(["ada", "bo", "me"]);
    expect(byId.get("ada")).toMatchObject({ viewerFollows: true, isViewer: false, handle: "ada_handle" });
    expect(byId.get("bo")).toMatchObject({ viewerFollows: false, isViewer: false });
    expect(byId.get("me")).toMatchObject({ isViewer: true });
    expect(res.nextCursor).toBeNull();
  });

  it("lists their followers", async () => {
    const res = await getPersonFollows({
      userId: "me",
      targetUserId: "them",
      list: "followers",
      db: fakeDb(GRAPH),
    });
    expect(res.users.map((u) => u.id).sort()).toEqual(["cy", "me"]);
  });

  it("leaves out anyone blocked in either direction with the viewer", async () => {
    const res = await getPersonFollows({
      userId: "me",
      targetUserId: "them",
      list: "following",
      db: fakeDb({ ...GRAPH, blocks: [{ blockerId: "bo", blockedId: "me" }] }),
    });
    expect(res.users.map((u) => u.id)).not.toContain("bo");
  });
});
