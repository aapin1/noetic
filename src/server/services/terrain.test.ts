import { beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import { getTerrain, TERRAIN_MIN_CAPTURES } from "@/server/services/terrain";

// No OpenAI key in tests → the narrative degrades to null, no network is touched.
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
});

interface FakeCapture {
  id: string;
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
    const id = `c${i}`;
    if (i < 20) {
      out.push({ id, capturedAt, embedding: [1, 0, 0], topics: t(i < 3 ? ["philosophy", "ethics"] : ["philosophy", "stoicism"]), contentItem: ci("Aeon", "Seneca") });
    } else if (i < 40) {
      out.push({ id, capturedAt, embedding: [0.5, 0.5, 0], topics: t(["philosophy", "logic"]), contentItem: ci("Aeon", null) });
    } else {
      out.push({ id, capturedAt, embedding: [0, 1, 0], topics: t(i > 56 ? ["ai", "ethics"] : ["ai", "transformers"]), contentItem: ci("arXiv", "Karpathy") });
    }
  }
  return out;
}

/**
 * Terrain reads in two phases — the light history first, then embeddings in
 * bounded pages — so the fake has to answer both. `embeddingPages` records the
 * page sizes actually requested, which is what pins the memory bound.
 */
function fakeDb(captures: FakeCapture[], embeddingPages: number[] = []): DbClient {
  const byId = new Map(captures.map((c) => [c.id, c]));

  return {
    capturedItem: {
      count: async () => captures.length,
      findMany: async (args?: {
        select?: Record<string, unknown>;
        where?: { id?: { in?: string[] } };
      }) => {
        const wantedIds = args?.where?.id?.in;
        if (args?.select?.embedding && wantedIds) {
          embeddingPages.push(wantedIds.length);
          return wantedIds
            .map((id) => byId.get(id))
            .filter((c): c is FakeCapture => Boolean(c))
            .map((c) => ({ id: c.id, embedding: c.embedding }));
        }
        return captures;
      },
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

  // The streamed dispersion uses a closed form rather than measuring each
  // vector against the centroid directly. This checks it against the naive
  // definition it replaced, on vectors that actually vary within an era.
  describe("era spread", () => {
    const EARLY_VECS = [
      [1, 0, 0],
      [0.9, 0.3, 0],
      [0.8, 0.6, 0],
      [2, 0.1, 0], // deliberately not unit length
    ];
    const RECENT_VECS = [
      [0, 1, 0],
      [0.2, 0.95, 0],
    ];

    function spreadFixture(): FakeCapture[] {
      const base = Date.parse("2026-01-01T12:00:00Z");
      return Array.from({ length: 60 }, (_, i) => {
        const embedding =
          i < 20 ? EARLY_VECS[i % EARLY_VECS.length]!
          : i < 40 ? [0.5, 0.5, 0]
          : RECENT_VECS[i % RECENT_VECS.length]!;
        return {
          id: `c${i}`,
          capturedAt: new Date(base + i * 86_400_000),
          embedding,
          topics: t(i < 20 ? ["philosophy", "stoicism"] : i < 40 ? ["philosophy", "logic"] : ["ai", "transformers"]),
          contentItem: ci("Aeon", "Seneca"),
        };
      });
    }

    /** The definition being replaced: mean cosine distance to the centroid. */
    function naiveSpread(vectors: number[][]): number {
      const dim = vectors[0]!.length;
      const center = new Array<number>(dim).fill(0);
      for (const v of vectors) for (let i = 0; i < dim; i += 1) center[i] += v[i]!;
      for (let i = 0; i < dim; i += 1) center[i] /= vectors.length;

      const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
      const norm = (a: number[]) => Math.sqrt(dot(a, a));

      let total = 0;
      for (const v of vectors) total += 1 - dot(v, center) / (norm(v) * norm(center));
      return total / vectors.length;
    }

    it("matches the direct mean-cosine-distance definition", async () => {
      const terrain = await getTerrain("u1", {}, fakeDb(spreadFixture()));

      // Era size is a third of 60 below the tighten threshold, so 20 captures
      // each, cycling through the vectors above.
      const early = Array.from({ length: 20 }, (_, i) => EARLY_VECS[i % EARLY_VECS.length]!);
      const recent = Array.from({ length: 20 }, (_, i) => RECENT_VECS[(i + 40) % RECENT_VECS.length]!);

      expect(terrain.earlySpread).toBe(Math.round(naiveSpread(early) * 1000));
      expect(terrain.recentSpread).toBe(Math.round(naiveSpread(recent) * 1000));
      // Guard against the assertion passing because both sides are zero.
      expect(terrain.earlySpread!).toBeGreaterThan(0);
    });
  });

  describe("embedding memory bound", () => {
    /** A long history — the case where loading every vector at once is an OOM. */
    function longHistory(count: number): FakeCapture[] {
      const base = Date.parse("2026-01-01T12:00:00Z");
      return Array.from({ length: count }, (_, i) => ({
        id: `c${i}`,
        capturedAt: new Date(base + i * 86_400_000),
        embedding: i < count / 2 ? [1, 0, 0] : [0, 1, 0],
        topics: t(i < count / 2 ? ["philosophy", "stoicism"] : ["ai", "transformers"]),
        contentItem: ci("Aeon", "Seneca"),
      }));
    }

    it("never asks for more than one page of embeddings at a time", async () => {
      const pages: number[] = [];
      await getTerrain("u1", {}, fakeDb(longHistory(1000), pages));

      expect(pages.length).toBeGreaterThan(1);
      expect(Math.max(...pages)).toBeLessThanOrEqual(200);
    });

    // Dispersion has a closed form over a running Σ v/|v| (see
    // RunningCentroid.dispersionAbout), so each vector is read exactly once —
    // no second pass over the eras.
    it("reads every embedding exactly once", async () => {
      const pages: number[] = [];
      await getTerrain("u1", {}, fakeDb(longHistory(1000), pages));

      const total = pages.reduce((sum, size) => sum + size, 0);
      expect(total).toBe(1000);
    });

    it("produces the same drift reading whether or not paging kicks in", async () => {
      // 60 captures fits in a single page; 1000 forces many. The measured drift
      // is a property of the data, so it must not depend on how it was read.
      const small = await getTerrain("u1", {}, fakeDb(longHistory(60)));
      const large = await getTerrain("u1", {}, fakeDb(longHistory(1000)));

      expect(small.driftDegrees).toBe(90);
      expect(large.driftDegrees).toBe(90);
    });
  });
});
