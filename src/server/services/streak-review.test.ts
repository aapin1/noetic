import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { getStreakSummary, localDayIndex, recordReviewActivity } from "@/server/services/streak";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-08-08T12:00:00Z");
const DAY_MS = 86_400_000;

function fakeDb(state: {
  activityDays?: number[];
  frozenDays?: number[];
  captureDates?: Date[];
}) {
  const saved: { update?: Record<string, unknown>; create?: Record<string, unknown> }[] = [];
  const db = {
    userPreference: {
      findUnique: vi.fn(async () => ({
        streakActivityDays: state.activityDays ?? [],
        streakFrozenDays: state.frozenDays ?? [],
      })),
      upsert: vi.fn(async (args: { update: Record<string, unknown>; create: Record<string, unknown> }) => {
        saved.push(args);
        return args.update;
      }),
    },
    capturedItem: {
      findMany: vi.fn(async () => (state.captureDates ?? []).map((d) => ({ capturedAt: d }))),
    },
  } as unknown as DbClient;
  return { db, saved };
}

describe("recordReviewActivity", () => {
  it("credits the first visit of a local day and writes the day index once", async () => {
    const { db, saved } = fakeDb({});

    const result = await recordReviewActivity({ userId: "u1", tzOffsetMinutes: 0, db, now: NOW });

    expect(result.credited).toBe(true);
    expect(result.dayIndex).toBe(localDayIndex(NOW, 0));
    expect(saved).toHaveLength(1);
    expect(saved[0].update?.streakActivityDays).toEqual([result.dayIndex]);
  });

  it("is idempotent within the day — the second visit credits nothing and writes nothing", async () => {
    const today = localDayIndex(NOW, 0);
    const { db, saved } = fakeDb({ activityDays: [today] });

    const result = await recordReviewActivity({ userId: "u1", tzOffsetMinutes: 0, db, now: NOW });

    expect(result.credited).toBe(false);
    expect(saved).toHaveLength(0);
  });

  it("buckets by the caller's local day, not UTC", async () => {
    // 03:00 UTC on the 8th is still 23:00 on the 7th for UTC-4 (-240).
    const lateNight = new Date("2026-08-08T03:00:00Z");
    const { db } = fakeDb({});

    const utc = await recordReviewActivity({ userId: "u1", tzOffsetMinutes: 0, db, now: lateNight });
    const newYork = await recordReviewActivity({
      userId: "u1",
      tzOffsetMinutes: -240,
      db,
      now: lateNight,
    });

    expect(newYork.dayIndex).toBe(utc.dayIndex - 1);
  });

  it("credits again across the local-midnight boundary", async () => {
    const beforeMidnight = new Date("2026-08-08T03:59:00Z"); // 23:59 local at -240
    const afterMidnight = new Date("2026-08-08T04:01:00Z"); // 00:01 local at -240
    const firstDay = localDayIndex(beforeMidnight, -240);
    const { db, saved } = fakeDb({ activityDays: [firstDay] });

    const result = await recordReviewActivity({
      userId: "u1",
      tzOffsetMinutes: -240,
      db,
      now: afterMidnight,
    });

    expect(result.credited).toBe(true);
    expect(result.dayIndex).toBe(firstDay + 1);
    expect(saved[0].update?.streakActivityDays).toEqual([firstDay, firstDay + 1]);
  });
});

describe("getStreakSummary with review activity", () => {
  it("counts a review-only day exactly like a capture day", async () => {
    const today = localDayIndex(NOW, 0);
    const { db } = fakeDb({
      activityDays: [today],
      captureDates: [new Date(NOW.getTime() - DAY_MS)], // a capture yesterday
    });

    const summary = await getStreakSummary({ userId: "u1", tzOffsetMinutes: 0, db, now: NOW });

    expect(summary.current).toBe(2);
    expect(summary.heldDays).toBe(0);
  });

  it("does not double-count a day that has both a capture and a review", async () => {
    const today = localDayIndex(NOW, 0);
    const { db } = fakeDb({ activityDays: [today], captureDates: [NOW] });

    const summary = await getStreakSummary({ userId: "u1", tzOffsetMinutes: 0, db, now: NOW });

    expect(summary.current).toBe(1);
  });
});
