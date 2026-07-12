import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { getMemoryGraph } from "@/server/services/memory";

type CaptureRow = {
  id: string;
  kind: string;
  rawText: string | null;
  caption: string | null;
  reaction: string | null;
  keyIdea: string | null;
  capturedAt: Date;
  mapX: number | null;
  mapY: number | null;
  contentItem: { title: string } | null;
  topics: { topicId: string; weight: number; topic: { id: string; name: string } }[];
};

function captureRow(overrides: {
  id: string;
  topics?: CaptureRow["topics"];
  mapX?: number;
  mapY?: number;
}): CaptureRow {
  return {
    id: overrides.id,
    kind: "TEXT",
    rawText: `text for ${overrides.id}`,
    caption: null,
    reaction: null,
    keyIdea: null,
    capturedAt: new Date("2026-07-01T00:00:00Z"),
    // Positioned + non-collinear defaults so resolveSemanticCoords takes its
    // fast path and never fetches embeddings.
    mapX: overrides.mapX ?? Math.random(),
    mapY: overrides.mapY ?? Math.random(),
    contentItem: null,
    topics: overrides.topics ?? [],
  };
}

function fakeDb(config: { captures: CaptureRow[]; count?: number }) {
  const findMany = vi.fn(async (args: { where?: { topics?: { some: { topicId: string } } }; take?: number }) => {
    const topicId = args.where?.topics?.some.topicId;
    const filtered = topicId
      ? config.captures.filter((cap) => cap.topics.some((t) => t.topicId === topicId))
      : config.captures;
    return filtered.slice(0, args.take ?? filtered.length);
  });
  const count = vi.fn(async () => config.count ?? config.captures.length);
  const db = {
    capturedItem: { findMany, count },
    memoryEdge: { findMany: vi.fn(async () => []) },
    userPosition: { findMany: vi.fn(async () => []) },
  } as unknown as DbClient;
  return { db, findMany, count };
}

const PHILOSOPHY = { topicId: "t_phil", weight: 1, topic: { id: "t_phil", name: "philosophy" } };
const SCIENCE = { topicId: "t_sci", weight: 1, topic: { id: "t_sci", name: "science" } };

describe("getMemoryGraph topic filtering", () => {
  it("returns only captures tagged with the requested topic", async () => {
    const { db, findMany } = fakeDb({
      captures: [
        captureRow({ id: "a", topics: [PHILOSOPHY] }),
        captureRow({ id: "b", topics: [SCIENCE] }),
        captureRow({ id: "c", topics: [PHILOSOPHY, SCIENCE] }),
      ],
    });

    const graph = await getMemoryGraph({ userId: "u1", topicId: "t_phil", db });

    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "c"]);
    // The filter must be pushed into the query, not applied in memory.
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      userId: "u1",
      topics: { some: { topicId: "t_phil" } },
    });
  });

  it("omits the topic filter when no topicId is given", async () => {
    const { db, findMany } = fakeDb({
      captures: [captureRow({ id: "a", topics: [PHILOSOPHY] })],
    });

    const graph = await getMemoryGraph({ userId: "u1", db });

    expect(graph.nodes).toHaveLength(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: "u1" });
  });
});

describe("getMemoryGraph totalCount", () => {
  it("skips the count query when the page is not full", async () => {
    const { db, count } = fakeDb({
      captures: [captureRow({ id: "a" }), captureRow({ id: "b" })],
    });

    const graph = await getMemoryGraph({ userId: "u1", db });

    expect(graph.totalCount).toBe(2);
    expect(count).not.toHaveBeenCalled();
  });

  it("counts matching rows beyond the limit when the page is full", async () => {
    const captures = Array.from({ length: 10 }, (_, i) =>
      captureRow({ id: `cap${i}` }),
    );
    const { db, count } = fakeDb({ captures, count: 57 });

    // limit clamps to a minimum of 10, so a 10-row page is exactly full.
    const graph = await getMemoryGraph({ userId: "u1", limit: 10, db });

    expect(graph.nodes).toHaveLength(10);
    expect(graph.totalCount).toBe(57);
    expect(count).toHaveBeenCalledWith({ where: { userId: "u1" } });
  });
});
