import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { AppError } from "@/lib/api";
import {
  moveCaptureTopic,
  restoreUserSetTopics,
  snapshotUserSetTopics,
} from "@/server/services/topic-assign";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

type FakeState = {
  item?: { id: string; topics: { topicId: string }[] } | null;
  topic?: { id: string; name: string; slug: string } | null;
  assignmentRows?: Record<string, { weight: number }>;
};

function fakeDb(state: FakeState) {
  const calls = {
    deletedWhere: [] as unknown[],
    createdRows: [] as Record<string, unknown>[],
    updatedRows: [] as { where: unknown; data: Record<string, unknown> }[],
    itemUpdates: [] as Record<string, unknown>[],
    userUpdates: 0,
    weightWrites: [] as { topicId: string; weight: number }[],
    topicUpserts: [] as Record<string, unknown>[],
  };
  const db = {
    capturedItem: {
      findFirst: vi.fn(async (args: { where: { id: string; userId: string } }) => {
        void args;
        return state.item ?? null;
      }),
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.itemUpdates.push(args.data);
        return {};
      }),
    },
    topic: {
      findUnique: vi.fn(async () => state.topic ?? null),
      upsert: vi.fn(async (args: { create: { name: string; slug: string } }) => {
        calls.topicUpserts.push(args.create);
        return { id: "t_new", name: args.create.name, slug: args.create.slug };
      }),
    },
    capturedItemTopic: {
      deleteMany: vi.fn(async (args: { where: unknown }) => {
        calls.deletedWhere.push(args.where);
        return { count: 0 };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        calls.createdRows.push(args.data);
        return args.data;
      }),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        calls.updatedRows.push(args);
        return {};
      }),
      findUnique: vi.fn(
        async (args: { where: { capturedItemId_topicId: { topicId: string } } }) => {
          const row = state.assignmentRows?.[args.where.capturedItemId_topicId.topicId];
          return row ? { weight: row.weight } : null;
        },
      ),
      findMany: vi.fn(async () => []),
    },
    userTopic: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async (args: { create: { topicId: string; weight: number } }) => {
        calls.weightWrites.push({ topicId: args.create.topicId, weight: args.create.weight });
        return {};
      }),
    },
    user: {
      update: vi.fn(async () => {
        calls.userUpdates += 1;
        return {};
      }),
    },
  } as unknown as DbClient;
  return { db, calls };
}

describe("moveCaptureTopic", () => {
  it("404s for a capture the caller does not own", async () => {
    const { db } = fakeDb({ item: null });

    await expect(
      moveCaptureTopic({ userId: "u1", capturedItemId: "c1", topicId: "t1", db }),
    ).rejects.toMatchObject({ code: "CAPTURE_NOT_FOUND", status: 404 });
  });

  it("404s for an unknown topic id", async () => {
    const { db } = fakeDb({ item: { id: "c1", topics: [] }, topic: null });

    await expect(
      moveCaptureTopic({ userId: "u1", capturedItemId: "c1", topicId: "t_missing", db }),
    ).rejects.toMatchObject({ code: "TOPIC_NOT_FOUND", status: 404 });
  });

  it("rejects an empty free-text topic", async () => {
    const { db } = fakeDb({ item: { id: "c1", topics: [] } });

    await expect(
      moveCaptureTopic({ userId: "u1", capturedItemId: "c1", topicName: "   ", db }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("replaces the filing with one user-set row and re-seats the node", async () => {
    const { db, calls } = fakeDb({
      item: { id: "c1", topics: [{ topicId: "t_old" }] },
      topic: { id: "t_target", name: "Stoicism", slug: "stoicism" },
    });

    const moved = await moveCaptureTopic({
      userId: "u1",
      capturedItemId: "c1",
      topicId: "t_target",
      db,
    });

    expect(moved).toEqual({ topicId: "t_target", name: "Stoicism", slug: "stoicism" });
    expect(calls.deletedWhere).toEqual([{ capturedItemId: "c1" }]);
    expect(calls.createdRows).toEqual([
      { capturedItemId: "c1", topicId: "t_target", weight: 1, userSet: true },
    ]);
    expect(calls.itemUpdates).toEqual([{ mapX: null, mapY: null }]);
    expect(calls.userUpdates).toBe(1);
  });

  it("creates a topic from free text for 'somewhere new'", async () => {
    const { db, calls } = fakeDb({ item: { id: "c1", topics: [] } });

    const moved = await moveCaptureTopic({
      userId: "u1",
      capturedItemId: "c1",
      topicName: "  night   thoughts ",
      db,
    });

    expect(calls.topicUpserts).toEqual([{ name: "night thoughts", slug: "night-thoughts" }]);
    expect(moved.name).toBe("night thoughts");
    expect(calls.createdRows[0]).toMatchObject({ topicId: "t_new", userSet: true });
  });
});

describe("user-set filing survives re-classification", () => {
  it("re-pins a row the classifier dropped, restoring its weight bookkeeping", async () => {
    const { db, calls } = fakeDb({ assignmentRows: {} });

    await restoreUserSetTopics({
      userId: "u1",
      capturedItemId: "c1",
      rows: [{ topicId: "t_user", weight: 1 }],
      db,
    });

    expect(calls.createdRows).toEqual([
      { capturedItemId: "c1", topicId: "t_user", weight: 1, userSet: true },
    ]);
    expect(calls.weightWrites.map((w) => w.topicId)).toEqual(["t_user"]);
  });

  it("re-marks a row the classifier re-derived, keeping the stronger weight", async () => {
    const { db, calls } = fakeDb({ assignmentRows: { t_user: { weight: 0.7 } } });

    await restoreUserSetTopics({
      userId: "u1",
      capturedItemId: "c1",
      rows: [{ topicId: "t_user", weight: 1 }],
      db,
    });

    expect(calls.createdRows).toEqual([]);
    expect(calls.updatedRows).toHaveLength(1);
    expect(calls.updatedRows[0].data).toEqual({ userSet: true, weight: 1 });
    expect(calls.weightWrites).toEqual([]);
  });

  it("snapshot reads only user-set rows", async () => {
    const findMany = vi.fn(async () => [{ topicId: "t_user", weight: 1 }]);
    const db = { capturedItemTopic: { findMany } } as unknown as DbClient;

    const rows = await snapshotUserSetTopics({ capturedItemId: "c1", db });

    expect(rows).toEqual([{ topicId: "t_user", weight: 1 }]);
    const args = findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(args[0].where).toEqual({ capturedItemId: "c1", userSet: true });
  });
});
