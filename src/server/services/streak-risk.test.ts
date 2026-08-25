import { describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import {
  applyStreakRisk,
  localDayIndex,
  MIN_STREAK_TO_PROTECT,
  planStreakRisk,
  runStreakRiskSweep,
} from "@/server/services/streak";

/**
 * The evening reminder. What matters is that it speaks in exactly one
 * situation — a real run, active through yesterday, nothing today — and that
 * it never becomes a countdown: once per day, never after the day has been
 * credited, never for a run that is already the freeze's problem.
 */

const DAY_MS = 86_400_000;
/** 7pm UTC on a fixed day; the sweep only ever calls this at the evening hour. */
const NOW = new Date("2026-07-30T19:00:00Z");
const TODAY = localDayIndex(NOW, 0);

function run(length: number, endingYesterday = true): number[] {
  const last = endingYesterday ? TODAY - 1 : TODAY;
  return Array.from({ length }, (_, i) => last - i);
}

describe("planStreakRisk", () => {
  it("speaks for a run active through yesterday with nothing today", () => {
    expect(planStreakRisk({ activeDays: run(6), frozenDays: [], todayIdx: TODAY }))
      .toEqual({ streak: 6 });
  });

  it("is silent once today has been credited", () => {
    expect(planStreakRisk({ activeDays: run(6, false), frozenDays: [], todayIdx: TODAY })).toBeNull();
  });

  it("is silent when yesterday was missed — that is the freeze's morning, not a reminder", () => {
    const days = run(6).map((d) => d - 1); // ends the day before yesterday
    expect(planStreakRisk({ activeDays: days, frozenDays: [], todayIdx: TODAY })).toBeNull();
  });

  it("does not remind about a run too short to protect", () => {
    expect(planStreakRisk({
      activeDays: run(MIN_STREAK_TO_PROTECT - 1), frozenDays: [], todayIdx: TODAY,
    })).toBeNull();
    expect(planStreakRisk({
      activeDays: run(MIN_STREAK_TO_PROTECT), frozenDays: [], todayIdx: TODAY,
    })).toEqual({ streak: MIN_STREAK_TO_PROTECT });
  });

  it("counts through a frozen yesterday but does not count the freeze itself", () => {
    // Five real days, then yesterday bridged by a freeze: the run is alive and
    // five long. The reminder is exactly what keeps the bridge from being spent
    // for nothing.
    const days = run(5).map((d) => d - 1);
    expect(planStreakRisk({ activeDays: days, frozenDays: [TODAY - 1], todayIdx: TODAY }))
      .toEqual({ streak: 5 });
  });
});

type Notif = {
  recipientId: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

function fakeDb(args: {
  captureDays: number[];
  activityDays?: number[];
  frozenDays?: number[];
  tzOffsetMinutes?: number | null;
}) {
  const notifications: Notif[] = [];
  const db = {
    userPreference: {
      findUnique: async () => ({
        tzOffsetMinutes: args.tzOffsetMinutes ?? null,
        streakFrozenDays: args.frozenDays ?? [],
        streakActivityDays: args.activityDays ?? [],
      }),
    },
    capturedItem: {
      findMany: async () =>
        args.captureDays.map((day) => ({ capturedAt: new Date(day * DAY_MS + DAY_MS / 2) })),
    },
    user: { findUnique: async () => null },
    notification: {
      findFirst: async (q: { where: { recipientId: string; type: string; createdAt: { gte: Date } } }) => {
        const hit = notifications.find(
          (n) => n.recipientId === q.where.recipientId
            && n.type === q.where.type
            && n.createdAt >= q.where.createdAt.gte,
        );
        return hit ? { id: "existing" } : null;
      },
      create: async (q: { data: Omit<Notif, "createdAt"> }) => {
        notifications.push({ ...q.data, createdAt: NOW });
        return { id: `n${notifications.length}` };
      },
    },
  } as unknown as DbClient;
  return { db, notifications };
}

describe("applyStreakRisk", () => {
  it("queues one invitation naming the run, pointed at capture", async () => {
    const { db, notifications } = fakeDb({ captureDays: run(9) });

    const result = await applyStreakRisk({ userId: "u1", db, now: NOW });

    expect(result).toEqual({ userId: "u1", day: TODAY, streak: 9 });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "STREAK_AT_RISK",
      title: "9 days running",
      payload: { streakRisk: true, day: TODAY, streak: 9 },
    });
    // An invitation, not a deadline.
    expect(notifications[0].body).not.toMatch(/midnight|hours left|lose|break/);
  });

  it("reminds once per day, however many ticks land in the evening", async () => {
    const { db, notifications } = fakeDb({ captureDays: run(9) });

    await applyStreakRisk({ userId: "u1", db, now: NOW });
    const again = await applyStreakRisk({ userId: "u1", db, now: new Date(NOW.getTime() + 3_600_000) });

    expect(again).toBeNull();
    expect(notifications).toHaveLength(1);
  });

  it("treats a /today visit as activity, so reviewing counts as done", async () => {
    const { db, notifications } = fakeDb({ captureDays: run(9), activityDays: [TODAY] });

    expect(await applyStreakRisk({ userId: "u1", db, now: NOW })).toBeNull();
    expect(notifications).toHaveLength(0);
  });

  it("reads the remembered clock, so 'today' is the user's day", async () => {
    // 19:00Z is 3pm in UTC-4; the user captured at 1am local today, which is
    // yesterday in UTC. Under the stored offset that is today, so no reminder.
    const offset = -240;
    const localToday = localDayIndex(NOW, offset);
    const oneAmLocal = new Date(localToday * DAY_MS - offset * 60_000 + 3_600_000);
    const days = Array.from({ length: 5 }, (_, i) => localToday - 1 - i);
    const db = {
      ...fakeDb({ captureDays: days, tzOffsetMinutes: offset }).db,
    } as unknown as DbClient;
    (db.capturedItem as { findMany: unknown }).findMany = async () => [
      ...days.map((day) => ({ capturedAt: new Date(day * DAY_MS - offset * 60_000 + DAY_MS / 2) })),
      { capturedAt: oneAmLocal },
    ];

    expect(await applyStreakRisk({ userId: "u1", db, now: NOW })).toBeNull();
  });
});

describe("runStreakRiskSweep", () => {
  it("counts what it considered and what it queued, and survives one bad user", async () => {
    const good = fakeDb({ captureDays: run(4) });
    const db = {
      ...good.db,
      userPreference: {
        findUnique: async (q: { where: { userId: string } }) => {
          if (q.where.userId === "bad") throw new Error("corrupt row");
          return { tzOffsetMinutes: null, streakFrozenDays: [], streakActivityDays: [] };
        },
      },
    } as unknown as DbClient;

    const result = await runStreakRiskSweep({ db, now: NOW, userIds: ["u1", "bad", "u2"] });

    expect(result).toEqual({ considered: 3, queued: 2 });
  });
});
