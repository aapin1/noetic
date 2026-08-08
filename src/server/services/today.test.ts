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

function fakeDb(args: { captures: unknown[]; edges?: Edge[] }): DbClient {
  const captures = args.captures as { id: string }[];
  return {
    capturedItem: {
      findMany: vi.fn(async () => captures),
      findFirst: vi.fn(async (query: { where: { id: string } }) =>
        captures.find((c) => c.id === query.where.id) ?? null,
      ),
    },
    memoryEdge: {
      findMany: vi.fn(async () => [...(args.edges ?? [])].sort((a, b) => b.weight - a.weight)),
    },
  } as unknown as DbClient;
}

describe("getToday", () => {
  it("returns the quiet empty state for an account below the corpus floor", async () => {
    const db = fakeDb({ captures: [capture("c1", 40), capture("c2", 30)] });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload).toEqual({ capture: null, connection: null });
  });

  it("returns the empty state when nothing is old enough to resurface", async () => {
    const db = fakeDb({
      captures: [1, 2, 3, 4, 5, 6].map((n) => capture(`c${n}`, n)), // all < 7 days
    });

    const payload = await getToday({ userId: "u1", db, now: NOW });

    expect(payload).toEqual({ capture: null, connection: null });
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
});
