import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { AppError } from "@/lib/api";
import { getArchiveFolder, listArchiveFolders } from "@/server/services/archive";

type TopicFixture = { id: string; name: string; slug: string };

function topicRow(topic: TopicFixture, weight = 1) {
  return { topicId: topic.id, weight, topic };
}

/** Minimal CaptureWithRelations-shaped fixture — only the fields
 * serializeCapturedItem/captureTitle actually read. */
function captureFixture(overrides: {
  id: string;
  capturedAt: Date;
  topics: ReturnType<typeof topicRow>[];
  rawText?: string | null;
  kind?: string;
}) {
  return {
    id: overrides.id,
    kind: overrides.kind ?? "TEXT",
    rawText: overrides.rawText ?? `text for ${overrides.id}`,
    caption: null,
    mediaUrl: null,
    reaction: null,
    userContext: null,
    summary: null,
    keyIdea: null,
    capturedAt: overrides.capturedAt,
    contentItem: null,
    topics: overrides.topics,
    insights: [],
  };
}

function fakeDb(config: {
  listSelectResult?: unknown[];
  detailFindManyResult?: unknown[];
  topicFindUniqueResult?: TopicFixture | null;
}): DbClient {
  return {
    capturedItem: {
      findMany: vi.fn(async (args: { select?: unknown }) => {
        if (args?.select) return config.listSelectResult ?? [];
        return config.detailFindManyResult ?? [];
      }),
    },
    topic: {
      findUnique: vi.fn(async () => config.topicFindUniqueResult ?? null),
    },
  } as unknown as DbClient;
}

const PHILOSOPHY: TopicFixture = { id: "t_philosophy", name: "philosophy", slug: "philosophy" };
const PSYCHOLOGY: TopicFixture = { id: "t_psychology", name: "psychology", slug: "psychology" };
const STOICISM: TopicFixture = { id: "t_stoicism", name: "Stoicism", slug: "stoicism" };
const HABIT_FORMATION: TopicFixture = { id: "t_habits", name: "Habit Formation", slug: "habit-formation" };

describe("listArchiveFolders", () => {
  it("puts a general-tagged item into that topic's folder", async () => {
    const db = fakeDb({
      listSelectResult: [
        { id: "c1", capturedAt: new Date("2026-01-01"), topics: [topicRow(PHILOSOPHY)] },
      ],
    });

    const folders = await listArchiveFolders({ userId: "u1", db });

    expect(folders).toEqual([
      {
        topicId: PHILOSOPHY.id,
        name: PHILOSOPHY.name,
        slug: PHILOSOPHY.slug,
        kind: "general",
        count: 1,
        latestActivity: new Date("2026-01-01").toISOString(),
      },
    ]);
  });

  it("multi-homes an item tagged with two general topics", async () => {
    const db = fakeDb({
      listSelectResult: [
        {
          id: "c1",
          capturedAt: new Date("2026-01-01"),
          topics: [topicRow(PHILOSOPHY), topicRow(PSYCHOLOGY)],
        },
      ],
    });

    const folders = await listArchiveFolders({ userId: "u1", db });
    const topicIds = folders.map((f) => f.topicId).sort();

    expect(topicIds).toEqual([PHILOSOPHY.id, PSYCHOLOGY.id].sort());
    expect(folders.every((f) => f.count === 1)).toBe(true);
  });

  it("does not create a specific-topic folder for an item that also has a general topic", async () => {
    const db = fakeDb({
      listSelectResult: [
        {
          id: "c1",
          capturedAt: new Date("2026-01-01"),
          topics: [topicRow(PHILOSOPHY), topicRow(STOICISM)],
        },
      ],
    });

    const folders = await listArchiveFolders({ userId: "u1", db });

    expect(folders).toHaveLength(1);
    expect(folders[0].topicId).toBe(PHILOSOPHY.id);
    expect(folders[0].count).toBe(1);
  });

  it("falls back to a specific topic as a top-level folder when there's no general topic", async () => {
    const db = fakeDb({
      listSelectResult: [
        { id: "c1", capturedAt: new Date("2026-01-01"), topics: [topicRow(STOICISM)] },
      ],
    });

    const folders = await listArchiveFolders({ userId: "u1", db });

    expect(folders).toEqual([
      {
        topicId: STOICISM.id,
        name: STOICISM.name,
        slug: STOICISM.slug,
        kind: "specific",
        count: 1,
        latestActivity: new Date("2026-01-01").toISOString(),
      },
    ]);
  });

  it("buckets topic-less items into a single Uncategorized folder", async () => {
    const db = fakeDb({
      listSelectResult: [
        { id: "c1", capturedAt: new Date("2026-01-01"), topics: [] },
        { id: "c2", capturedAt: new Date("2026-01-02"), topics: [] },
      ],
    });

    const folders = await listArchiveFolders({ userId: "u1", db });

    expect(folders).toEqual([
      {
        topicId: "uncategorized",
        name: "Uncategorized",
        slug: "uncategorized",
        kind: "uncategorized",
        count: 2,
        latestActivity: new Date("2026-01-02").toISOString(),
      },
    ]);
  });

  it("omits the Uncategorized folder entirely when every item has a topic", async () => {
    const db = fakeDb({
      listSelectResult: [
        { id: "c1", capturedAt: new Date("2026-01-01"), topics: [topicRow(PHILOSOPHY)] },
      ],
    });

    const folders = await listArchiveFolders({ userId: "u1", db });

    expect(folders.some((f) => f.kind === "uncategorized")).toBe(false);
  });
});

describe("getArchiveFolder", () => {
  it("throws a 404 AppError when the topic doesn't exist", async () => {
    const db = fakeDb({ topicFindUniqueResult: null });

    await expect(getArchiveFolder({ userId: "u1", topicId: "missing", db })).rejects.toMatchObject({
      code: "TOPIC_NOT_FOUND",
      status: 404,
    } satisfies Partial<AppError>);
  });

  it("returns topic-less entries for the uncategorized bucket, with no sub-folders", async () => {
    const db = fakeDb({
      detailFindManyResult: [
        captureFixture({ id: "c1", capturedAt: new Date("2026-01-01"), topics: [] }),
      ],
    });

    const folder = await getArchiveFolder({ userId: "u1", topicId: "uncategorized", db });

    expect(folder.kind).toBe("uncategorized");
    expect(folder.subfolders).toEqual([]);
    expect(folder.entries).toHaveLength(1);
    expect(folder.entries[0].id).toBe("c1");
  });

  it("is a leaf (no sub-folders) when the topic is specific", async () => {
    const db = fakeDb({
      topicFindUniqueResult: STOICISM,
      detailFindManyResult: [
        captureFixture({ id: "c1", capturedAt: new Date("2026-01-01"), topics: [topicRow(STOICISM)] }),
      ],
    });

    const folder = await getArchiveFolder({ userId: "u1", topicId: STOICISM.id, db });

    expect(folder.kind).toBe("specific");
    expect(folder.subfolders).toEqual([]);
    expect(folder.entries).toHaveLength(1);
  });

  it("partitions a general folder into specific sub-folders and direct (no-specific-topic) entries", async () => {
    const db = fakeDb({
      topicFindUniqueResult: PHILOSOPHY,
      detailFindManyResult: [
        // Has a specific topic under this general → filed only in the Stoicism sub-folder.
        captureFixture({
          id: "c1",
          capturedAt: new Date("2026-01-01"),
          topics: [topicRow(PHILOSOPHY), topicRow(STOICISM)],
        }),
        // General only, no specific topic → sits directly in the folder.
        captureFixture({
          id: "c2",
          capturedAt: new Date("2026-01-02"),
          topics: [topicRow(PHILOSOPHY)],
        }),
        // Two specific topics → multi-homed across both sub-folders.
        captureFixture({
          id: "c3",
          capturedAt: new Date("2026-01-03"),
          topics: [topicRow(PHILOSOPHY), topicRow(STOICISM), topicRow(HABIT_FORMATION)],
        }),
      ],
    });

    const folder = await getArchiveFolder({ userId: "u1", topicId: PHILOSOPHY.id, db });

    expect(folder.kind).toBe("general");
    expect(folder.entries.map((e) => e.id)).toEqual(["c2"]);

    const stoicism = folder.subfolders.find((f) => f.topicId === STOICISM.id);
    const habits = folder.subfolders.find((f) => f.topicId === HABIT_FORMATION.id);
    expect(stoicism?.count).toBe(2); // c1 and c3
    expect(habits?.count).toBe(1); // c3 only
  });
});
