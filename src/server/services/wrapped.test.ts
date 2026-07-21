import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { getWrappedStats } from "@/server/services/wrapped";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

/** 2026-07-09T18:00:00Z = 2pm on Thursday in UTC-4. */
const NOW = new Date("2026-07-09T18:00:00Z");

/** Same instant, either side of local midnight in UTC-4. */
const EVENING_BEFORE = new Date("2026-07-09T02:00:00Z"); // Jul 8, 10pm local
const THIS_AFTERNOON = new Date("2026-07-09T17:30:00Z"); // Jul 9, 1:30pm local

function fakeDb(capturedAts: Date[]): DbClient {
  return {
    follow: {
      findMany: async () => [],
      count: async () => 0,
    },
    capturedItem: {
      findMany: async () => capturedAts.map((capturedAt) => ({ kind: "TEXT", capturedAt, topics: [] })),
    },
  } as unknown as DbClient;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getWrappedStats arcs", () => {
  it("always returns full-length buckets, even with no captures", async () => {
    const stats = await getWrappedStats("user_1", {}, fakeDb([]));

    expect(stats.totalCaptures).toBe(0);
    expect(stats.arcs.hours).toHaveLength(24);
    expect(stats.arcs.days).toHaveLength(30);
    expect(stats.arcs.weeks).toHaveLength(12);
    expect(stats.arcs.months).toHaveLength(6);
    expect(stats.arcs.months.every((m) => m.count === 0)).toBe(true);
  });

  it("ends each arc on the current bucket in the caller's timezone", async () => {
    const stats = await getWrappedStats("user_1", { tzOffsetMinutes: -240 }, fakeDb([THIS_AFTERNOON]));

    expect(stats.arcs.hours[23].label).toBe("2p");
    expect(stats.arcs.days[29].label).toBe("9");
    expect(stats.arcs.months[5].label).toBe("Jul");

    // 1:30pm local is one hour before the 2pm bucket.
    expect(stats.arcs.hours[22].count).toBe(1);
    expect(stats.arcs.days[29].count).toBe(1);
  });

  it("buckets a late-evening capture into the previous local day", async () => {
    const utc = await getWrappedStats("user_1", { tzOffsetMinutes: 0 }, fakeDb([EVENING_BEFORE]));
    const eastern = await getWrappedStats("user_1", { tzOffsetMinutes: -240 }, fakeDb([EVENING_BEFORE]));

    expect(utc.arcs.days[29].count).toBe(1);
    expect(eastern.arcs.days[29].count).toBe(0);
    expect(eastern.arcs.days[28].count).toBe(1);
  });
});

describe("getWrappedStats local-clock derivations", () => {
  it("reports the busiest hour and weekday on the caller's clock", async () => {
    const utc = await getWrappedStats("user_1", { tzOffsetMinutes: 0 }, fakeDb([THIS_AFTERNOON]));
    const eastern = await getWrappedStats("user_1", { tzOffsetMinutes: -240 }, fakeDb([THIS_AFTERNOON]));

    expect(utc.busiestHour).toBe(17);
    expect(eastern.busiestHour).toBe(13);
    expect(eastern.busiestDayOfWeek).toBe("Thursday");
    expect(eastern.hourHistogram[13]).toBe(1);
  });

  it("counts streaks by local day, not UTC day", async () => {
    const captures = [EVENING_BEFORE, THIS_AFTERNOON];

    // Both land on Jul 9 in UTC, so they're a single day.
    const utc = await getWrappedStats("user_1", { tzOffsetMinutes: 0 }, fakeDb(captures));
    expect(utc.longestStreak).toBe(1);

    // In UTC-4 they straddle midnight: Jul 8 and Jul 9.
    const eastern = await getWrappedStats("user_1", { tzOffsetMinutes: -240 }, fakeDb(captures));
    expect(eastern.longestStreak).toBe(2);
    expect(eastern.currentStreak).toBe(2);
  });

  it("keeps the streak alive when the last capture was yesterday", async () => {
    const yesterday = new Date("2026-07-08T17:00:00Z"); // Jul 8, 1pm in UTC-4
    const dayBefore = new Date("2026-07-07T17:00:00Z");

    const stats = await getWrappedStats(
      "user_1",
      { tzOffsetMinutes: -240 },
      fakeDb([dayBefore, yesterday]),
    );

    expect(stats.currentStreak).toBe(2);
  });

  it("ends the current streak once a day has been missed", async () => {
    // A clean three-day run that stopped five days ago. The record stands; the
    // streak does not.
    const run = [
      new Date("2026-07-01T17:00:00Z"),
      new Date("2026-07-02T17:00:00Z"),
      new Date("2026-07-03T17:00:00Z"),
    ];

    const stats = await getWrappedStats("user_1", { tzOffsetMinutes: -240 }, fakeDb(run));

    expect(stats.longestStreak).toBe(3);
    expect(stats.currentStreak).toBe(0);
  });

  it("ignores an out-of-range timezone offset instead of skewing the buckets", async () => {
    const stats = await getWrappedStats("user_1", { tzOffsetMinutes: Number.NaN }, fakeDb([THIS_AFTERNOON]));

    expect(stats.busiestHour).toBe(17);
  });
});
