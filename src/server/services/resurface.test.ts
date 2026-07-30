import { describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import { enqueueResurfaceFor, selectResurfaceCandidate } from "@/server/services/resurface";

/**
 * The selection engine's whole job is judgement: say the most interesting true
 * thing, or say nothing. These tests pin the priority order, the refusal to
 * speak on a thin corpus, and the guarantee that a run never repeats itself.
 */

const NOW = new Date("2026-07-30T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

type Capture = {
  id: string;
  rawText: string | null;
  capturedAt: Date;
  contentItem: { title: string; siteName: string | null; source: { name: string } | null } | null;
  topics: { topicId: string; topic: { name: string } }[];
};

type Edge = { fromItemId: string; toItemId: string };

function capture(
  id: string,
  ageDays: number,
  topics: string[],
  opts: { title?: string; source?: string } = {},
): Capture {
  return {
    id,
    rawText: null,
    capturedAt: daysAgo(ageDays),
    contentItem: {
      title: opts.title ?? `capture ${id}`,
      siteName: opts.source ?? "example.com",
      source: opts.source ? { name: opts.source } : null,
    },
    // topicId is derived from the name so the same name is the same topic.
    topics: topics.map((name) => ({ topicId: `t-${name}`, topic: { name } })),
  };
}

/** A notification row as the engine writes and later reads it. */
type Notif = { type: string; payload: Record<string, unknown>; createdAt: Date };

function fakeDb(args: {
  captures: Capture[];
  edges?: Edge[];
  existing?: Notif[];
}) {
  const notifications: Notif[] = [...(args.existing ?? [])];
  const byId = new Map(args.captures.map((c) => [c.id, c]));

  const db = {
    notification: {
      findFirst: async (q: { where: { createdAt?: { gte: Date } } }) => {
        const since = q.where.createdAt?.gte;
        const hit = notifications.find((n) => !since || n.createdAt >= since);
        return hit ? { id: "existing" } : null;
      },
      findMany: async () => notifications.map((n) => ({ payload: n.payload })),
      create: async (q: { data: { type: string; payload: Record<string, unknown> } }) => {
        notifications.push({ type: q.data.type, payload: q.data.payload, createdAt: NOW });
        return { id: `n${notifications.length}` };
      },
    },
    capturedItem: {
      findMany: async () =>
        [...args.captures].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime()),
    },
    memoryEdge: {
      findMany: async () =>
        (args.edges ?? []).map((e) => ({
          fromItemId: e.fromItemId,
          toItemId: e.toItemId,
          fromItem: {
            rawText: null,
            contentItem: { title: byId.get(e.fromItemId)?.contentItem?.title ?? "a" },
          },
          toItem: {
            rawText: null,
            contentItem: { title: byId.get(e.toItemId)?.contentItem?.title ?? "b" },
          },
        })),
    },
    user: { findUnique: async () => null },
  } as unknown as DbClient;

  return { db, notifications };
}

/** A healthy, varied corpus: enough material that every tier could fire. */
function richCorpus(): Capture[] {
  return [
    // "attention" — hot this week, so it has momentum.
    capture("a1", 1, ["attention", "philosophy"], { source: "Aeon" }),
    capture("a2", 2, ["attention", "philosophy"], { source: "arXiv" }),
    capture("a3", 3, ["attention"], { source: "LessWrong" }),
    capture("a4", 4, ["attention"], { source: "Aeon" }),
    capture("a5", 25, ["attention"], { source: "Aeon" }),
    // "stoicism" — untouched for a month, so it has gone dormant.
    capture("s1", 40, ["stoicism", "philosophy"], { source: "Aeon" }),
    capture("s2", 45, ["stoicism"], { source: "Penguin" }),
    capture("s3", 50, ["stoicism"], { source: "Aeon" }),
    // filler, so the corpus clears the floors.
    capture("f1", 10, ["typography"], { source: "Practical Typography" }),
    capture("f2", 12, ["typography"], { source: "Butterick" }),
    capture("f3", 14, ["urbanism"], { source: "Strong Towns" }),
    capture("f4", 16, ["urbanism"], { source: "CityLab" }),
    capture("f5", 18, ["urbanism"], { source: "Strong Towns" }),
  ];
}

describe("selectResurfaceCandidate", () => {
  it("says nothing to a user with a thin corpus", async () => {
    const { db } = fakeDb({ captures: [capture("c1", 1, ["attention"])] });
    expect(await selectResurfaceCandidate({ userId: "u1", db, now: NOW })).toBeNull();
  });

  it("says nothing rather than something weak on a modest corpus with no signal", async () => {
    // Six captures, all one topic, all recent, no contradictions, nothing
    // dormant, one source, nothing old enough for an anniversary.
    const captures = Array.from({ length: 6 }, (_, i) =>
      capture(`c${i}`, i, ["attention"], { source: "Aeon" }),
    );
    const { db } = fakeDb({ captures });
    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });
    // A single-source, single-topic burst is not a convergence and not a thread
    // worth interrupting someone for.
    expect(pick).toBeNull();
  });

  it("prefers a fresh contradiction over everything else available", async () => {
    const { db } = fakeDb({
      captures: richCorpus(),
      edges: [{ fromItemId: "a1", toItemId: "a3" }],
    });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.type).toBe("CONTRADICTION_FOUND");
    // Names the actual topic — the thing that makes it worth opening.
    expect(pick?.title).toBe("two things you saved about attention disagree");
    expect(pick?.key).toBe("contradiction:a1:a3");
  });

  it("falls to thread momentum when there is no contradiction", async () => {
    const { db } = fakeDb({ captures: richCorpus() });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.type).toBe("THREAD_MOMENTUM");
    expect(pick?.title).toBe("attention is picking up");
  });

  it("falls to dormancy when nothing is accelerating", async () => {
    // Same corpus with the recent burst removed: nothing is rising, but
    // stoicism is still long silent.
    const captures = richCorpus().filter((c) => !c.id.startsWith("a") || c.id === "a5");
    const { db } = fakeDb({ captures });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.type).toBe("DORMANT_REVIVAL");
    expect(pick?.title).toBe("you left stoicism unfinished");
    expect(pick?.deepLink).toBe("/archive/t-stoicism");
  });

  it("never names a general field, only a specific thread", async () => {
    const { db } = fakeDb({ captures: richCorpus() });
    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });
    // "philosophy" spans the corpus and would win any size-based ranking.
    expect(pick?.title).not.toContain("philosophy");
  });

  it("enforces one push per user per day", async () => {
    const { db } = fakeDb({
      captures: richCorpus(),
      existing: [{ type: "THREAD_MOMENTUM", payload: {}, createdAt: daysAgo(0) }],
    });

    expect(await selectResurfaceCandidate({ userId: "u1", db, now: NOW })).toBeNull();
  });

  it("never repeats itself across runs", async () => {
    const { db } = fakeDb({
      captures: richCorpus(),
      edges: [
        { fromItemId: "a1", toItemId: "a3" },
        { fromItemId: "a2", toItemId: "a4" },
      ],
    });

    const seen: string[] = [];
    // One run a day for a week, each a day after the last so the daily cap
    // never masks a repeat.
    for (let day = 0; day < 7; day += 1) {
      const now = new Date(NOW.getTime() + day * DAY);
      const picked = await enqueueResurfaceFor({ userId: "u1", db, now });
      if (picked) seen.push(picked.key);
    }

    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("works down the priority ladder as each tier is exhausted", async () => {
    const { db } = fakeDb({
      captures: richCorpus(),
      edges: [{ fromItemId: "a1", toItemId: "a3" }],
    });

    const types: string[] = [];
    for (let day = 0; day < 4; day += 1) {
      const now = new Date(NOW.getTime() + day * DAY);
      const picked = await enqueueResurfaceFor({ userId: "u1", db, now });
      if (picked) types.push(picked.type);
    }

    // Contradiction first, then momentum, then the quieter signals — never the
    // other way around.
    expect(types[0]).toBe("CONTRADICTION_FOUND");
    expect(types[1]).toBe("THREAD_MOMENTUM");
    expect(types.slice(2)).not.toContain("CONTRADICTION_FOUND");
  });

  it("stores a dedupe key on the notification it enqueues", async () => {
    const { db, notifications } = fakeDb({
      captures: richCorpus(),
      edges: [{ fromItemId: "a1", toItemId: "a3" }],
    });

    await enqueueResurfaceFor({ userId: "u1", db, now: NOW });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].payload.resurfaceKey).toBe("contradiction:a1:a3");
  });

  it("resurfaces an old capture only for a corpus with real history", async () => {
    // Exactly one thing to say: a capture from ~30 days ago. Nothing recent,
    // nothing contradictory, every topic single-source.
    const captures = Array.from({ length: 14 }, (_, i) =>
      capture(`c${i}`, 30 + i * 3, [`topic${i}`], { source: "Aeon" }),
    );
    const { db } = fakeDb({ captures });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.type).toBe("RESURFACE");
    expect(pick?.title).toBe("a month ago, you saved this");
    expect(pick?.deepLink).toBe("/insight/c0");
  });

  it("withholds the anniversary tier from a corpus too small to earn it", async () => {
    // Same shape as above, but under the anniversary floor.
    const captures = Array.from({ length: 8 }, (_, i) =>
      capture(`c${i}`, 30 + i * 3, [`topic${i}`], { source: "Aeon" }),
    );
    const { db } = fakeDb({ captures });

    expect(await selectResurfaceCandidate({ userId: "u1", db, now: NOW })).toBeNull();
  });
});
