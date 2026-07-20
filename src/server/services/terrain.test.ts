import { beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import { getTerrain, TERRAIN_MIN_CAPTURES } from "@/server/services/terrain";

// No OpenAI key in tests → the narrative degrades to null, no network is touched.
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
});

interface FakeCapture {
  capturedAt: Date;
  embedding: number[];
  topics: { topic: { name: string } }[];
  contentItem: { siteName: string | null; authorName: string | null; source: { name: string } | null } | null;
}

function t(names: string[]): { topic: { name: string } }[] {
  return names.map((name) => ({ topic: { name } }));
}

function ci(source: string | null, author: string | null): FakeCapture["contentItem"] {
  return { siteName: null, authorName: author, source: source ? { name: source } : null };
}

/**
 * 60 captures: an early era anchored at [1,0,0] tagged philosophy/stoicism, a
 * recent era at [0,1,0] tagged ai/transformers, with `ethics` spanning both.
 */
function buildCaptures(): FakeCapture[] {
  const out: FakeCapture[] = [];
  const base = Date.parse("2026-01-01T12:00:00Z");
  for (let i = 0; i < 60; i += 1) {
    const capturedAt = new Date(base + i * 86_400_000);
    if (i < 20) {
      out.push({ capturedAt, embedding: [1, 0, 0], topics: t(i < 3 ? ["philosophy", "ethics"] : ["philosophy", "stoicism"]), contentItem: ci("Aeon", "Seneca") });
    } else if (i < 40) {
      out.push({ capturedAt, embedding: [0.5, 0.5, 0], topics: t(["philosophy", "logic"]), contentItem: ci("Aeon", null) });
    } else {
      out.push({ capturedAt, embedding: [0, 1, 0], topics: t(i > 56 ? ["ai", "ethics"] : ["ai", "transformers"]), contentItem: ci("arXiv", "Karpathy") });
    }
  }
  return out;
}

function fakeDb(captures: FakeCapture[]): DbClient {
  return {
    capturedItem: {
      count: async () => captures.length,
      findMany: async () => captures,
    },
    terrainCache: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
    memoryEdge: {
      findMany: async () => [
        { fromItem: { topics: t(["stoicism"]) }, toItem: { topics: t(["transformers"]) } },
      ],
    },
    userPosition: {
      findMany: async () => [{ challenges: [{ revised: true }] }, { challenges: [] }],
    },
  } as unknown as DbClient;
}

describe("getTerrain", () => {
  it("stays locked below the capture floor", async () => {
    const db = fakeDb(buildCaptures().slice(0, TERRAIN_MIN_CAPTURES - 1));
    const terrain = await getTerrain("u1", {}, db);
    expect(terrain.unlocked).toBe(false);
    expect(terrain.captureCount).toBe(TERRAIN_MIN_CAPTURES - 1);
  });

  it("splits history into equal outer-third eras", async () => {
    const terrain = await getTerrain("u1", {}, fakeDb(buildCaptures()));
    expect(terrain.unlocked).toBe(true);
    expect(terrain.captureCount).toBe(60);
    expect(terrain.eraSize).toBe(20);
  });

  it("classifies enduring / emerged / faded specific topics", async () => {
    const terrain = await getTerrain("u1", {}, fakeDb(buildCaptures()));
    expect(terrain.enduring).toContain("ethics"); // in both eras
    expect(terrain.emerged).toContain("transformers"); // recent only
    expect(terrain.faded).toContain("stoicism"); // early only
    expect(terrain.emerged).not.toContain("stoicism");
    expect(terrain.faded).not.toContain("transformers");
  });

  it("measures semantic drift toward the recent field and away from the early one", async () => {
    const terrain = await getTerrain("u1", {}, fakeDb(buildCaptures()));
    expect(terrain.driftDegrees).not.toBeNull();
    expect(terrain.driftDegrees!).toBeGreaterThan(30); // orthogonal-ish eras
    expect(terrain.towardField).toBe("ai");
    expect(terrain.awayField).toBe("philosophy");
  });

  it("surfaces cross-domain bridges and conviction counts", async () => {
    const terrain = await getTerrain("u1", {}, fakeDb(buildCaptures()));
    expect(terrain.bridgeCount).toBe(1);
    expect(terrain.bridges[0]).toEqual({ a: "stoicism", b: "transformers" });
    expect(terrain.positionsStaked).toBe(2);
    expect(terrain.positionsChallenged).toBe(1);
    expect(terrain.positionsRevised).toBe(1);
  });

  it("aggregates the sources and voices you consume", async () => {
    const terrain = await getTerrain("u1", {}, fakeDb(buildCaptures()));
    const sources = terrain.topSources.map((s) => s.name);
    const voices = terrain.topVoices.map((v) => v.name);
    expect(sources).toContain("Aeon");
    expect(sources).toContain("arXiv");
    expect(voices).toContain("Seneca");
    expect(voices).toContain("Karpathy");
    // Aeon appears on 40 captures, arXiv on 20 — most-frequent first.
    expect(terrain.topSources[0].name).toBe("Aeon");
  });

  it("reports distinct-topic breadth per era", async () => {
    const terrain = await getTerrain("u1", {}, fakeDb(buildCaptures()));
    // early specifics: stoicism, ethics; recent specifics: transformers, ethics.
    expect(terrain.earlyDistinctTopics).toBe(2);
    expect(terrain.recentDistinctTopics).toBe(2);
  });
});
