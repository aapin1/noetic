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

/** An unacknowledged challenge row, as the tier-0 query selects it. */
type Challenge = {
  id: string;
  position: { topicId: string; topic: { name: string } };
  capturedItem: { rawText: string | null; contentItem: { title: string } | null } | null;
};

function challengeOn(id: string, topicName: string, captureTitle: string): Challenge {
  return {
    id,
    position: { topicId: `t-${topicName}`, topic: { name: topicName } },
    capturedItem: { rawText: null, contentItem: { title: captureTitle } },
  };
}

function fakeDb(args: {
  captures: Capture[];
  edges?: Edge[];
  existing?: Notif[];
  challenge?: Challenge;
}) {
  const notifications: Notif[] = [...(args.existing ?? [])];
  const byId = new Map(args.captures.map((c) => [c.id, c]));

  const db = {
    notification: {
      // Honours the type filter as well as the window: the cooldown query names
      // the types it counts, and STREAK_HELD being among them is the
      // arbitration rule rather than an accident.
      findFirst: async (q: { where: { createdAt?: { gte: Date }; type?: { in: string[] } } }) => {
        const since = q.where.createdAt?.gte;
        const types = q.where.type?.in;
        const hit = notifications.find(
          (n) => (!since || n.createdAt >= since) && (!types || types.includes(n.type)),
        );
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
    positionChallenge: {
      findFirst: async () => args.challenge ?? null,
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
  it("keeps the day-2 promise: a first fragment comes back the next morning", async () => {
    // One capture from yesterday — every observational tier is silenced by the
    // corpus floor, but the onboarding ritual promised this exact comeback.
    const { db } = fakeDb({
      captures: [capture("c1", 1, ["attention"], { title: "walking unsticks thinking" })],
    });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.type).toBe("RESURFACE");
    expect(pick?.key).toBe("first-thought:c1");
    expect(pick?.title).toBe("still on your mind?");
    expect(pick?.body).toContain("walking unsticks thinking");
    expect(pick?.body).toContain("yesterday");
    expect(pick?.deepLink).toBe("/today");
  });

  it("brings early fragments back oldest first, each exactly once, then goes quiet", async () => {
    const { db } = fakeDb({
      captures: [
        capture("c1", 2, ["attention"], { title: "first thought" }),
        capture("c2", 1, ["attention"], { title: "second thought" }),
      ],
    });

    const keys: string[] = [];
    for (let day = 0; day < 4; day += 1) {
      const now = new Date(NOW.getTime() + day * DAY);
      const picked = await enqueueResurfaceFor({ userId: "u1", db, now });
      if (picked) keys.push(picked.key);
    }

    expect(keys).toEqual(["first-thought:c1", "first-thought:c2"]);
  });

  it("never brings back a capture from the same morning", async () => {
    // Saved two hours ago: a comeback before lunch is an echo, not a promise.
    const captures = [capture("c1", 0, ["attention"])];
    captures[0]!.capturedAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    const { db } = fakeDb({ captures });

    expect(await selectResurfaceCandidate({ userId: "u1", db, now: NOW })).toBeNull();
  });

  it("gives a stalled weeks-old thin account silence, not a random echo", async () => {
    // Two captures, but the account's first save is three weeks old — the
    // comeback window has passed and the observational floor still applies.
    const { db } = fakeDb({
      captures: [capture("c1", 21, ["attention"]), capture("c2", 20, ["attention"])],
    });

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

  it("puts a challenge to a staked position above every other tier", async () => {
    // A contradiction edge is also available — the strongest ordinary tier —
    // and the challenge still wins: it names a commitment, not a pattern.
    const { db } = fakeDb({
      captures: richCorpus(),
      edges: [{ fromItemId: "a1", toItemId: "a3" }],
      challenge: challengeOn("ch1", "Attention", "Deep Work Is Overrated"),
    });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.type).toBe("CONTRADICTION_FOUND");
    expect(pick?.key).toBe("position-challenge:ch1");
    expect(pick?.title).toBe("a new capture challenges your position on attention");
    expect(pick?.body).toContain("revise or hold");
    expect(pick?.deepLink).toBe("/today");
  });

  it("pushes a position challenge even below the corpus floor", async () => {
    // One capture — every observational tier is silenced — but the collision
    // with a staked position is an event, not an observation.
    const { db } = fakeDb({
      captures: [capture("c1", 1, ["attention"])],
      challenge: challengeOn("ch1", "attention", "Deep Work Is Overrated"),
    });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    expect(pick?.key).toBe("position-challenge:ch1");
  });

  it("yields the day to a streak push even when a challenge is pending", async () => {
    // The one-push-per-day guarantee sits above arbitration: the cap is
    // checked before any tier — including the challenge — is consulted.
    const { db, notifications } = fakeDb({
      captures: richCorpus(),
      challenge: challengeOn("ch1", "attention", "Deep Work Is Overrated"),
      existing: [{ type: "STREAK_HELD", payload: {}, createdAt: NOW }],
    });

    expect(await enqueueResurfaceFor({ userId: "u1", db, now: NOW })).toBeNull();
    expect(notifications).toHaveLength(1);
  });

  it("never pushes the same challenge twice", async () => {
    const { db } = fakeDb({
      captures: richCorpus(),
      challenge: challengeOn("ch1", "attention", "Deep Work Is Overrated"),
      existing: [
        {
          type: "CONTRADICTION_FOUND",
          payload: { resurfaceKey: "position-challenge:ch1" },
          createdAt: daysAgo(2),
        },
      ],
    });

    const pick = await selectResurfaceCandidate({ userId: "u1", db, now: NOW });

    // The challenge is spent; selection falls through to the ordinary tiers.
    expect(pick?.key).not.toBe("position-challenge:ch1");
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

  it("yields the day to a streak push, and is still eligible tomorrow", async () => {
    // The load-bearing arbitration test. A streak push is perishable — it is
    // only true today — so it takes the slot. What must NOT happen is the
    // resurfacing candidate being selected and then losing: selection writes
    // the notification, and loadSeenKeys reads every row regardless of status,
    // so the contradiction would be marked seen and never sent. Yielding before
    // selection costs nothing, because the contradiction is exactly as
    // interesting tomorrow.
    const { db, notifications } = fakeDb({
      captures: richCorpus(),
      edges: [{ fromItemId: "a1", toItemId: "a3" }],
      existing: [{ type: "STREAK_HELD", payload: {}, createdAt: NOW }],
    });

    expect(await enqueueResurfaceFor({ userId: "u1", db, now: NOW })).toBeNull();
    // Nothing was written, so nothing was consumed.
    expect(notifications).toHaveLength(1);

    const tomorrow = new Date(NOW.getTime() + DAY);
    const picked = await enqueueResurfaceFor({ userId: "u1", db, now: tomorrow });

    expect(picked?.type).toBe("CONTRADICTION_FOUND");
    expect(picked?.key).toBe("contradiction:a1:a3");
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
    expect(pick?.deepLink).toBe("/today");
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
