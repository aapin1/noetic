import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import {
  activityScore,
  getPersonalIntelligence,
  groupCapturesByTopic,
  preferSpecific,
  rankByActivity,
  type LoadedCapture,
} from "@/server/services/intelligence";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/server/cognition/llm", () => ({
  generateContradictionTension: vi.fn(async () => ({ tension: "t", crux: "c", test: "x" })),
  generateThreadSynthesis: vi.fn(async () => ({
    position: "p", openQuestion: "q", heading: "h", driftNotes: [],
  })),
  generateConvergenceSignal: vi.fn(async () => ({ signal: "s", arrival: "a", act: "k" })),
  generateTopicTension: vi.fn(async () => ({
    tension: "t", crux: "c", test: "x", aIndex: 0, bIndex: 1,
  })),
}));

import {
  generateConvergenceSignal,
  generateThreadSynthesis,
  generateTopicTension,
} from "@/server/cognition/llm";

const NOW = new Date("2026-07-21T12:00:00Z");
const DAY = 86_400_000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

function capture(id: string, topic: string, at: Date): LoadedCapture {
  return {
    id,
    label: id,
    rawText: `text ${id}`,
    gist: `text ${id}`,
    keyIdea: null,
    capturedAt: at,
    sourceName: `src-${id.slice(-1)}`,
    topics: [{ topicId: topic, name: topic }],
  };
}

/** A DB whose capture list can be swapped between calls, with a cache row that
 * persists across them exactly as the real table would. */
function fakeDb(initial: LoadedCapture[]) {
  let captures = initial;
  let cacheRow: { userId: string; version: number; payload: unknown } | null = null;

  const db = {
    user: { findUnique: async () => ({ tasteProfileVersion: 1 }) },
    intelligenceCache: {
      findUnique: async () => cacheRow,
      upsert: async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        cacheRow = (cacheRow ? { ...cacheRow, ...update } : create) as typeof cacheRow;
        return cacheRow;
      },
    },
    capturedItem: {
      findMany: async () =>
        [...captures]
          .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
          .map((c) => ({
            id: c.id,
            rawText: c.rawText,
            userContext: null,
            summary: null,
            keyIdea: null,
            capturedAt: c.capturedAt,
            contentItem: {
              title: c.label,
              description: null,
              siteName: c.sourceName,
              source: { name: c.sourceName },
            },
            topics: c.topics.map((t) => ({ topicId: t.topicId, topic: { name: t.name } })),
          })),
    },
    memoryEdge: { findMany: async () => [] },
  } as unknown as DbClient;

  return {
    db,
    add(item: LoadedCapture) {
      captures = [...captures, item];
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("activity ranking", () => {
  it("decays a topic's weight by half every 30 days", () => {
    const fresh = groupCapturesByTopic([capture("a", "x", NOW)], 1)[0];
    const old = groupCapturesByTopic([capture("b", "x", daysAgo(30))], 1)[0];

    expect(activityScore(fresh, NOW)).toBeCloseTo(1, 5);
    expect(activityScore(old, NOW)).toBeCloseTo(0.5, 5);
  });

  it("ranks a small live topic above a large one that has gone quiet", () => {
    const captures = [
      ...Array.from({ length: 20 }, (_, i) => capture(`old${i}`, "settled", daysAgo(300 + i))),
      ...Array.from({ length: 4 }, (_, i) => capture(`new${i}`, "current", daysAgo(i))),
    ];
    const ranked = rankByActivity(groupCapturesByTopic(captures, 2), NOW);

    // By raw count "settled" wins 20–4, which is exactly how the same topics
    // used to hold every Mind slot forever.
    expect(ranked[0].topicId).toBe("current");
  });
});

describe("preferSpecific", () => {
  it("keeps coarse fields from taking slots a specific topic could hold", () => {
    // Every capture is filed under a general field, so "philosophy" is always
    // the biggest and freshest group — it used to win every slot forever.
    const captures = [
      ...Array.from({ length: 30 }, (_, i) => capture(`g${i}`, "philosophy", daysAgo(i % 10))),
      ...Array.from({ length: 5 }, (_, i) => capture(`s${i}`, "stoicism", daysAgo(i))),
      ...Array.from({ length: 4 }, (_, i) => capture(`v${i}`, "virtue ethics", daysAgo(i))),
    ];
    const ranked = rankByActivity(groupCapturesByTopic(captures, 2), NOW);

    expect(ranked[0].topicId).toBe("philosophy");
    expect(preferSpecific(ranked, 2).map((g) => g.topicId)).toEqual(["stoicism", "virtue ethics"]);
  });

  it("falls back to fields when there aren't enough specific topics", () => {
    const captures = [
      ...Array.from({ length: 6 }, (_, i) => capture(`g${i}`, "philosophy", daysAgo(i))),
      ...Array.from({ length: 3 }, (_, i) => capture(`s${i}`, "stoicism", daysAgo(i))),
    ];
    const ranked = rankByActivity(groupCapturesByTopic(captures, 2), NOW);

    expect(preferSpecific(ranked, 4).map((g) => g.topicId)).toEqual(["stoicism", "philosophy"]);
  });
});

describe("getPersonalIntelligence caching", () => {
  it("reuses cached prose for untouched topics and regenerates only what moved", async () => {
    const captures = [
      ...Array.from({ length: 4 }, (_, i) => capture(`p${i}`, "physics", daysAgo(i + 1))),
      ...Array.from({ length: 4 }, (_, i) => capture(`m${i}`, "music", daysAgo(i + 1))),
    ];
    const store = fakeDb(captures);

    const first = await getPersonalIntelligence({ userId: "u1", db: store.db });
    expect(first.threadSyntheses).toHaveLength(2);
    expect(vi.mocked(generateThreadSynthesis)).toHaveBeenCalledTimes(2);

    // Re-open with nothing new: everything comes off the cache.
    vi.clearAllMocks();
    const second = await getPersonalIntelligence({ userId: "u1", db: store.db });
    expect(second.threadSyntheses).toHaveLength(2);
    expect(vi.mocked(generateThreadSynthesis)).not.toHaveBeenCalled();
    expect(vi.mocked(generateConvergenceSignal)).not.toHaveBeenCalled();
    expect(vi.mocked(generateTopicTension)).not.toHaveBeenCalled();

    // One new capture in physics: physics regenerates, music does not.
    vi.clearAllMocks();
    store.add(capture("p9", "physics", NOW));
    const third = await getPersonalIntelligence({ userId: "u1", db: store.db });
    expect(third.threadSyntheses).toHaveLength(2);
    expect(vi.mocked(generateThreadSynthesis)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generateThreadSynthesis).mock.calls[0][0].topicName).toBe("physics");
  });
});
