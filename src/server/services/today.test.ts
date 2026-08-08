import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { getToday } from "@/server/services/today";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-08-08T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 86_400_000);
}

function capture(id: string, ageDays: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: "TEXT",
    rawText: `capture ${id}`,
    caption: null,
    mediaUrl: null,
    reaction: null,
    userContext: null,
    summary: null,
    keyIdea: null,
    userTitle: null,
    capturedAt: daysAgo(ageDays),
    contentItem: null,
    topics: [],
    ...overrides,
  };
}

type Edge = { fromItemId: string; toItemId: string; type: string; weight: number };
type Contradiction = Edge & { createdAt: Date };

/** An unacknowledged challenge row, as getCollision selects it. */
function challengeRow(id: string, topicName: string, captureId: string | null) {
  return {
    id,
    tension: `tension for ${id}`,
    position: { statement: `my position on ${topicName}`, topicId: `t-${topicName}`, topic: { name: topicName } },
    capturedItem: captureId
      ? { id: captureId, rawText: `capture ${captureId}`, contentItem: null }
      : null,
  };
}

function fakeDb(args: {
  captures: unknown[];
  edges?: Edge[];
  challenge?: ReturnType<typeof challengeRow>;
  contradictions?: Contradiction[];
}): DbClient {
  const captures = args.captures as { id: string; rawText: string }[];
  const byId = new Map(captures.map((c) => [c.id, c]));
  return {
    capturedItem: {
      findMany: vi.fn(async () => captures),
      findFirst: vi.fn(async (query: { where: { id: string } }) =>
        captures.find((c) => c.id === query.where.id) ?? null,
      ),
    },
    memoryEdge: {
      findMany: vi.fn(async () => [...(args.edges ?? [])].sort((a, b) => b.weight - a.weight)),
      // The collision query: honours the weight floor and the freshness window.
      findFirst: vi.fn(async (q: { where: { weight: { gte: number }; createdAt: { gte: Date } } }) => {
        const hit = [...(args.contradictions ?? [])]
          .filter((e) => e.weight >= q.where.weight.gte && e.createdAt >= q.where.createdAt.gte)
          .sort((a, b) => b.weight - a.weight)[0];
        if (!hit) return null;
        const item = (id: string) => ({
          id,
          rawText: byId.get(id)?.rawText ?? null,
          contentItem: null,
        });
        return { fromItem: item(hit.fromItemId), toItem: item(hit.toItemId) };
      }),
    },
    positionChallenge: {
      findFirst: vi.fn(async () => args.challenge ?? null),
    },
  } as unknown as DbClient;
}

describe("getToday", () => {
  it("returns the quiet empty state for an account below the corpus floor", async () => {
    const db = fakeDb({ captures: [capture("c1", 40), capture("c2", 30)] });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload).toEqual({ challenge: null, collision: null, capture: null, connection: null });
  });

  it("returns the empty state when nothing is old enough to resurface", async () => {
    const db = fakeDb({
      captures: [1, 2, 3, 4, 5, 6].map((n) => capture(`c${n}`, n)), // all < 7 days
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload).toEqual({ challenge: null, collision: null, capture: null, connection: null });
  });

  it("picks an old-enough capture, stably within the same day, with no connection when there are no edges", async () => {
    const db = fakeDb({
      captures: [
        capture("young", 1),
        ...[10, 12, 14, 16, 18].map((age, i) => capture(`old${i}`, age)),
      ],
    });

    const first = await getToday({ userId: "u1", db, now: NOW });
    const second = await getToday({ userId: "u1", db, now: NOW });

    expect(first.capture).not.toBeNull();
    expect(first.capture!.id).not.toBe("young");
    expect(first.capture!.whyNow).toMatch(/^saved \d+ days ago/);
    expect(second.capture!.id).toBe(first.capture!.id);
    expect(first.connection).toBeNull();
  });

  it("prefers an anniversary capture and says so", async () => {
    const db = fakeDb({
      captures: [
        capture("anniv", 30),
        ...[10, 12, 14, 16, 18].map((age, i) => capture(`old${i}`, age)),
      ],
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.capture!.id).toBe("anniv");
    expect(payload.capture!.whyNow).toBe("a month ago today, you saved this. does it still hold?");
  });

  it("surfaces the strongest edge in either direction with the neighbour's title", async () => {
    const db = fakeDb({
      captures: [
        capture("anniv", 30),
        capture("weakly-related", 15),
        capture("strongly-related", 20),
        capture("old3", 12),
        capture("old4", 14),
      ],
      edges: [
        { fromItemId: "weakly-related", toItemId: "anniv", type: "RELATED", weight: 0.5 },
        { fromItemId: "strongly-related", toItemId: "anniv", type: "CONTRADICTS", weight: 0.8 },
      ],
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.connection).toEqual({
      itemId: "strongly-related",
      title: "capture strongly-related",
      type: "CONTRADICTS",
      weight: 0.8,
    });
  });

  it("drops edges below the weight floor rather than showing a weak pair", async () => {
    const db = fakeDb({
      captures: [capture("anniv", 30), ...[10, 12, 14, 16].map((age, i) => capture(`old${i}`, age))],
      edges: [{ fromItemId: "old0", toItemId: "anniv", type: "RELATED", weight: 0.3 }],
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.connection).toBeNull();
  });

  it("leads with an unacknowledged position challenge, even below the corpus floor", async () => {
    // Two captures — the ritual has nothing to hand back — but the user staked
    // a position and a capture collided with it. The event outranks the floor.
    const db = fakeDb({
      captures: [capture("c1", 40), capture("c2", 30)],
      challenge: challengeRow("ch1", "attention", "c1"),
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.challenge).toEqual({
      challengeId: "ch1",
      topicId: "t-attention",
      topicName: "attention",
      statement: "my position on attention",
      tension: "tension for ch1",
      capture: { id: "c1", title: "capture c1" },
    });
    expect(payload.collision).toBeNull();
  });

  it("falls to a strong fresh CONTRADICTS pair when no challenge is pending", async () => {
    const db = fakeDb({
      captures: [capture("anniv", 30), ...[10, 12, 14, 16].map((age, i) => capture(`old${i}`, age))],
      contradictions: [
        { fromItemId: "old0", toItemId: "anniv", type: "CONTRADICTS", weight: 0.55, createdAt: daysAgo(1) },
      ],
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.challenge).toBeNull();
    expect(payload.collision).toEqual({
      itemA: { id: "old0", title: "capture old0" },
      itemB: { id: "anniv", title: "capture anniv" },
    });
    // The ritual still runs underneath the takeover.
    expect(payload.capture).not.toBeNull();
  });

  it("lets a weak or stale contradiction pass without taking over", async () => {
    const db = fakeDb({
      captures: [capture("anniv", 30), ...[10, 12, 14, 16].map((age, i) => capture(`old${i}`, age))],
      contradictions: [
        // Strong enough but old news; and fresh but in the weak half of the band.
        { fromItemId: "old0", toItemId: "anniv", type: "CONTRADICTS", weight: 0.6, createdAt: daysAgo(5) },
        { fromItemId: "old1", toItemId: "anniv", type: "CONTRADICTS", weight: 0.45, createdAt: daysAgo(1) },
      ],
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.challenge).toBeNull();
    expect(payload.collision).toBeNull();
  });

  it("prefers the challenge over a strong fresh contradiction", async () => {
    const db = fakeDb({
      captures: [capture("anniv", 30), ...[10, 12, 14, 16].map((age, i) => capture(`old${i}`, age))],
      challenge: challengeRow("ch1", "attention", "old0"),
      contradictions: [
        { fromItemId: "old0", toItemId: "anniv", type: "CONTRADICTS", weight: 0.6, createdAt: daysAgo(1) },
      ],
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload.challenge?.challengeId).toBe("ch1");
    expect(payload.collision).toBeNull();
  });
});
