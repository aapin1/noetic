import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import {
  blockUser,
  blockedUserIds,
  listBlockedUsers,
  reportUser,
  unblockUser,
} from "@/server/services/moderation";
import type { DbClient } from "@/server/db";

type BlockRow = { blockerId: string; blockedId: string; createdAt: Date };
type FollowRow = { followerId: string; followingId: string };
type ReportRow = { reporterId: string; reportedId: string; reason: string; details?: string };

/**
 * In-memory stand-in for the four tables moderation touches. Mirrors the shape
 * of fakeDb in usage.test.ts so the two read the same way.
 */
function fakeDb(
  opts: {
    users?: string[];
    blocks?: { blockerId: string; blockedId: string }[];
    follows?: FollowRow[];
  } = {},
) {
  const users = new Set(opts.users ?? ["me", "them", "third"]);
  const blocks: BlockRow[] = (opts.blocks ?? []).map((b) => ({ ...b, createdAt: new Date() }));
  const follows: FollowRow[] = [...(opts.follows ?? [])];
  const reports: ReportRow[] = [];

  const matches = (row: BlockRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => row[k as keyof BlockRow] === v);

  const evaluate = (row: BlockRow, where: Record<string, unknown>): boolean => {
    if (Array.isArray(where.OR)) {
      return (where.OR as Record<string, unknown>[]).some((clause) => matches(row, clause));
    }
    return matches(row, where);
  };

  const db = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.has(where.id) ? { id: where.id } : null,
    },
    userBlock: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        blocks.filter((row) => evaluate(row, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        blocks.find((row) => evaluate(row, where)) ?? null,
      upsert: async ({
        where,
      }: {
        where: { blockerId_blockedId: { blockerId: string; blockedId: string } };
      }) => {
        const { blockerId, blockedId } = where.blockerId_blockedId;
        const existing = blocks.find((b) => b.blockerId === blockerId && b.blockedId === blockedId);
        if (existing) return existing;
        const row = { blockerId, blockedId, createdAt: new Date() };
        blocks.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0;
        for (let i = blocks.length - 1; i >= 0; i--) {
          if (evaluate(blocks[i]!, where)) {
            blocks.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
    follow: {
      deleteMany: async ({ where }: { where: { OR: FollowRow[] } }) => {
        let count = 0;
        for (let i = follows.length - 1; i >= 0; i--) {
          const row = follows[i]!;
          if (
            where.OR.some(
              (c) => c.followerId === row.followerId && c.followingId === row.followingId,
            )
          ) {
            follows.splice(i, 1);
            count++;
          }
        }
        return { count };
      },
    },
    userReport: {
      create: async ({ data }: { data: ReportRow }) => {
        reports.push(data);
        return data;
      },
    },
  } as unknown as DbClient;

  return { db, blocks, follows, reports };
}

describe("blockUser", () => {
  it("records the block", async () => {
    const { db, blocks } = fakeDb();
    await expect(blockUser({ userId: "me", targetUserId: "them", db })).resolves.toEqual({
      blocked: true,
    });
    expect(blocks).toHaveLength(1);
  });

  // The whole point of the feature: an abusive account that stays subscribed to
  // your Pulse after you block it is not blocked in any sense that matters.
  it("severs the follow edge in BOTH directions", async () => {
    const { db, follows } = fakeDb({
      follows: [
        { followerId: "me", followingId: "them" },
        { followerId: "them", followingId: "me" },
        { followerId: "third", followingId: "me" },
      ],
    });

    await blockUser({ userId: "me", targetUserId: "them", db });

    expect(follows).toEqual([{ followerId: "third", followingId: "me" }]);
  });

  it("is idempotent — blocking twice does not duplicate the row", async () => {
    const { db, blocks } = fakeDb();
    await blockUser({ userId: "me", targetUserId: "them", db });
    await blockUser({ userId: "me", targetUserId: "them", db });
    expect(blocks).toHaveLength(1);
  });

  it("rejects self-blocking", async () => {
    const { db } = fakeDb();
    await expect(blockUser({ userId: "me", targetUserId: "me", db })).rejects.toThrow(AppError);
  });

  it("404s on an account that does not exist", async () => {
    const { db } = fakeDb({ users: ["me"] });
    await expect(blockUser({ userId: "me", targetUserId: "ghost", db })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("blockedUserIds", () => {
  // Symmetry is what stops the blocked party from still seeing the blocker.
  it("returns the other party whether they blocked me or I blocked them", async () => {
    const { db } = fakeDb({
      blocks: [
        { blockerId: "me", blockedId: "them" },
        { blockerId: "third", blockedId: "me" },
      ],
    });

    const ids = await blockedUserIds("me", db);
    expect([...ids].sort()).toEqual(["them", "third"]);
  });

  it("does not leak blocks between unrelated users", async () => {
    const { db } = fakeDb({ blocks: [{ blockerId: "them", blockedId: "third" }] });
    await expect(blockedUserIds("me", db)).resolves.toEqual([]);
  });

  it("de-duplicates a mutual block", async () => {
    const { db } = fakeDb({
      blocks: [
        { blockerId: "me", blockedId: "them" },
        { blockerId: "them", blockedId: "me" },
      ],
    });
    await expect(blockedUserIds("me", db)).resolves.toEqual(["them"]);
  });
});

describe("unblockUser", () => {
  it("removes only my block, not one pointing the other way", async () => {
    const { db, blocks } = fakeDb({
      blocks: [
        { blockerId: "me", blockedId: "them" },
        { blockerId: "them", blockedId: "me" },
      ],
    });

    await expect(unblockUser({ userId: "me", targetUserId: "them", db })).resolves.toEqual({
      blocked: false,
    });
    expect(blocks).toEqual([
      expect.objectContaining({ blockerId: "them", blockedId: "me" }),
    ]);
  });

  // deleteMany, not delete — a retried unblock must not 404.
  it("is a no-op when nothing is blocked", async () => {
    const { db } = fakeDb();
    await expect(unblockUser({ userId: "me", targetUserId: "them", db })).resolves.toEqual({
      blocked: false,
    });
  });
});

describe("reportUser", () => {
  it("writes the report", async () => {
    const { db, reports } = fakeDb();
    await expect(
      reportUser({ userId: "me", targetUserId: "them", reason: "harassment", db }),
    ).resolves.toEqual({ reported: true });
    expect(reports).toEqual([
      { reporterId: "me", reportedId: "them", reason: "harassment", details: undefined },
    ]);
  });

  it("rejects self-reporting", async () => {
    const { db } = fakeDb();
    await expect(
      reportUser({ userId: "me", targetUserId: "me", reason: "spam", db }),
    ).rejects.toThrow(AppError);
  });

  it("404s on an account that does not exist", async () => {
    const { db } = fakeDb({ users: ["me"] });
    await expect(
      reportUser({ userId: "me", targetUserId: "ghost", reason: "spam", db }),
    ).rejects.toMatchObject({ status: 404 });
  });

  // Repeat reports are signal, not an error to surface to the reporter.
  it("allows the same reporter to file again", async () => {
    const { db, reports } = fakeDb();
    await reportUser({ userId: "me", targetUserId: "them", reason: "spam", db });
    await reportUser({ userId: "me", targetUserId: "them", reason: "hate", db });
    expect(reports).toHaveLength(2);
  });
});

describe("listBlockedUsers", () => {
  it("lists only accounts I blocked, never ones that blocked me", async () => {
    const { db } = fakeDb({
      blocks: [
        { blockerId: "me", blockedId: "them" },
        { blockerId: "third", blockedId: "me" },
      ],
    });

    // findMany is filtered by the service's `where`, which the fake evaluates.
    const listDb = {
      ...db,
      userBlock: {
        ...(db as unknown as { userBlock: object }).userBlock,
        findMany: async ({ where }: { where: { blockerId: string } }) =>
          where.blockerId === "me"
            ? [
                {
                  createdAt: new Date("2026-07-28T00:00:00Z"),
                  blocked: {
                    id: "them",
                    profile: { handle: "them", displayName: "Them", avatarUrl: null },
                  },
                },
              ]
            : [],
      },
    } as unknown as DbClient;

    const result = await listBlockedUsers("me", listDb);
    expect(result.users).toEqual([
      {
        id: "them",
        handle: "them",
        displayName: "Them",
        avatarUrl: null,
        blockedAt: "2026-07-28T00:00:00.000Z",
      },
    ]);
  });
});
