import { describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import {
  FREEZE_REFILL_DAYS,
  MIN_STREAK_TO_PROTECT,
  applyStreakGuard,
  localDayIndex,
  planStreakFreeze,
} from "@/server/services/streak";
import { computeStreaks } from "@/server/services/wrapped";

/**
 * Streak protection has two failure modes that matter, and they pull in
 * opposite directions:
 *
 *  - Spending a freeze when it saves nothing (or saves something not worth
 *    saving), which burns the week's protection and then announces it.
 *  - Not spending one when a single missed day is about to erase weeks.
 *
 * These tests simulate capture histories with 1-, 2- and 8-day gaps against
 * both, and pin the third rule the feature is built on: nothing here ever warns
 * anybody about a streak that has not already been rescued.
 */

const DAY_MS = 86_400_000;
const NOW = new Date("2026-07-30T12:00:00Z");
const TODAY = localDayIndex(NOW, 0);

/** Consecutive local day indices ending `endingDaysAgo` before today. */
function run(length: number, endingDaysAgo: number): number[] {
  const end = TODAY - endingDaysAgo;
  return Array.from({ length }, (_, i) => end - (length - 1 - i));
}

describe("planStreakFreeze — gaps", () => {
  it("holds a one-day gap, and reports the run it saved", () => {
    // Ten days through the day before yesterday, then yesterday missed.
    const plan = planStreakFreeze({
      captureDays: run(10, 2),
      frozenDays: [],
      todayIdx: TODAY,
      lastFreezeDay: null,
    });

    expect(plan).toEqual({ day: TODAY - 1, streak: 10 });
  });

  it("spends nothing on a two-day gap — the run is already gone", () => {
    // Captures stop three days ago: yesterday AND the day before are both
    // empty, so there is no live run for a freeze to bridge to.
    const plan = planStreakFreeze({
      captureDays: run(10, 3),
      frozenDays: [],
      todayIdx: TODAY,
      lastFreezeDay: null,
    });

    expect(plan).toBeNull();
  });

  it("spends nothing after an eight-day absence", () => {
    const plan = planStreakFreeze({
      captureDays: run(10, 8),
      frozenDays: [],
      todayIdx: TODAY,
      lastFreezeDay: null,
    });

    expect(plan).toBeNull();
  });

  it("spends nothing when yesterday was captured", () => {
    const plan = planStreakFreeze({
      captureDays: run(10, 1),
      frozenDays: [],
      todayIdx: TODAY,
      lastFreezeDay: null,
    });

    expect(plan).toBeNull();
  });

  it("refuses to spend the week's freeze on a run too short to matter", () => {
    const plan = planStreakFreeze({
      captureDays: run(MIN_STREAK_TO_PROTECT - 1, 2),
      frozenDays: [],
      todayIdx: TODAY,
      lastFreezeDay: null,
    });

    expect(plan).toBeNull();
  });
});

describe("planStreakFreeze — weekly refill", () => {
  it("does not hold a second day inside the same week", () => {
    const plan = planStreakFreeze({
      captureDays: run(10, 2),
      frozenDays: [TODAY - 4],
      todayIdx: TODAY,
      lastFreezeDay: TODAY - 4,
    });

    expect(plan).toBeNull();
  });

  it("holds again once a full week separates the two covered days", () => {
    // The freeze about to be spent covers yesterday, so the refill is measured
    // from there — not from today, which would shorten the week by a day.
    const lastFreezeDay = TODAY - 1 - FREEZE_REFILL_DAYS;
    const plan = planStreakFreeze({
      captureDays: run(20, 2),
      frozenDays: [lastFreezeDay],
      todayIdx: TODAY,
      lastFreezeDay,
    });

    expect(plan?.day).toBe(TODAY - 1);
  });

  it("does not refill a day early", () => {
    const lastFreezeDay = TODAY - FREEZE_REFILL_DAYS;
    const plan = planStreakFreeze({
      captureDays: run(20, 2),
      frozenDays: [lastFreezeDay],
      todayIdx: TODAY,
      lastFreezeDay,
    });

    expect(plan).toBeNull();
  });

  it("a consecutive second missed day breaks the streak rather than stacking freezes", () => {
    // Yesterday's sweep held the day before. Today the user has missed a second
    // day running — the freeze is weekly, so this one is not covered.
    const frozen = [TODAY - 2];
    const captureDays = run(10, 3);

    expect(
      planStreakFreeze({ captureDays, frozenDays: frozen, todayIdx: TODAY, lastFreezeDay: TODAY - 2 }),
    ).toBeNull();

    // And the streak is genuinely over, not limping along on the old freeze.
    expect(computeStreaks(captureDays, TODAY, frozen).current).toBe(0);
  });
});

describe("computeStreaks with freezes", () => {
  it("bridges the gap without counting the frozen day", () => {
    // Mon–Wed captured, Thu frozen, Fri captured.
    const captureDays = [TODAY - 5, TODAY - 4, TODAY - 3, TODAY - 1];
    const frozen = [TODAY - 2];

    const { current, longest, held } = computeStreaks(captureDays, TODAY, frozen);

    expect(current).toBe(4);
    expect(longest).toBe(4);
    expect(held).toBe(1);
  });

  it("keeps longest honest — a frozen day never pads the record", () => {
    const captureDays = [TODAY - 5, TODAY - 4, TODAY - 3, TODAY - 1];
    const frozen = [TODAY - 2];

    // Five covered days, but only four on which anything was actually saved.
    expect(computeStreaks(captureDays, TODAY, frozen).longest).toBe(4);
  });

  it("never reports a current streak longer than the longest", () => {
    // The pair (current 15 / longest 12) has to be unreachable, not merely
    // unlikely — so sweep a range of shapes and assert the invariant directly.
    for (let length = 1; length <= 30; length += 1) {
      for (let gapAt = 1; gapAt < length; gapAt += 1) {
        const days = run(length, 1).filter((d) => d !== TODAY - 1 - gapAt);
        const frozen = [TODAY - 1 - gapAt];
        const { current, longest } = computeStreaks(days, TODAY, frozen);
        expect(current).toBeLessThanOrEqual(longest);
      }
    }
  });

  it("does not keep a dead streak alive on a frozen day alone", () => {
    // Captures ended, a freeze covered the next day, then nothing for a week.
    const captureDays = run(10, 9);
    const frozen = [TODAY - 8];

    expect(computeStreaks(captureDays, TODAY, frozen).current).toBe(0);
    expect(computeStreaks(captureDays, TODAY, frozen).longest).toBe(10);
  });

  it("ignores a freeze on a day that was captured anyway", () => {
    const captureDays = run(5, 1);
    const { current, held } = computeStreaks(captureDays, TODAY, [TODAY - 1]);

    expect(current).toBe(5);
    expect(held).toBe(0);
  });
});

/* ------------------------------------------------------------ no warnings -- */

describe("the guard never warns", () => {
  /**
   * The load-bearing test. A streak that is merely *at risk* — captured through
   * yesterday, nothing today yet — must produce no plan and therefore no
   * notification. If this ever goes green in the other direction, the feature
   * has turned into the thing it was built to avoid.
   */
  it("produces nothing for a streak that is only at risk", () => {
    for (let length = MIN_STREAK_TO_PROTECT; length <= 40; length += 1) {
      const plan = planStreakFreeze({
        captureDays: run(length, 1),
        frozenDays: [],
        todayIdx: TODAY,
        lastFreezeDay: null,
      });
      expect(plan).toBeNull();
    }
  });

  it("queues one STREAK_HELD describing a live run, and nothing else", async () => {
    const { db, notifications, saved } = fakeDb({ captureDays: run(12, 2) });

    const held = await applyStreakGuard({ userId: "u1", db, now: NOW });

    expect(held).toEqual({ userId: "u1", day: TODAY - 1, streak: 12 });
    expect(notifications).toHaveLength(1);

    const [notification] = notifications;
    expect(notification.type).toBe("STREAK_HELD");
    expect(notification.title).toBe("your 12 days are still alive");
    expect(notification.body).toBe(
      "you missed yesterday — we bridged it. capture today and the run holds.",
    );

    // No language that turns this into a deadline.
    const copy = `${notification.title} ${notification.body}`.toLowerCase();
    for (const word of ["risk", "about to", "don't lose", "expires", "hurry", "last chance", "tonight"]) {
      expect(copy).not.toContain(word);
    }

    // And no claim that the save is finished. A second missed day breaks the
    // run — the freeze is weekly — so anything in the past tense about having
    // "kept" or "saved" the streak becomes false without us sending a word.
    for (const phrase of ["we kept", "we saved", "we held your", "is safe", "protected"]) {
      expect(copy).not.toContain(phrase);
    }

    // The freeze is persisted, so a second sweep the same day is a no-op.
    expect(saved.streakFrozenDays).toEqual([TODAY - 1]);
    expect(saved.streakLastFreezeDay).toBe(TODAY - 1);
  });

  it("never prunes a freeze that is still bridging the live run", async () => {
    // A 200-day run with a freeze 120 days back. An over-eager retention
    // horizon would drop that day, split the run at it, and cut the user's
    // streak roughly in half — a "streak randomly reset" bug with no trace.
    const captureDays = run(200, 2).filter((d) => d !== TODAY - 120);
    const { db, saved } = fakeDb({
      captureDays,
      frozenDays: [TODAY - 120],
      lastFreezeDay: TODAY - 120,
    });

    await applyStreakGuard({ userId: "u1", db, now: NOW });

    expect(saved.streakFrozenDays).toContain(TODAY - 120);
    // Both the old bridge and today's new one survive the write.
    expect(saved.streakFrozenDays).toEqual([TODAY - 120, TODAY - 1]);
    expect(computeStreaks(captureDays, TODAY, saved.streakFrozenDays).current).toBe(199);
  });

  it("queues nothing when there is nothing to hold", async () => {
    const { db, notifications } = fakeDb({ captureDays: run(12, 1) });

    expect(await applyStreakGuard({ userId: "u1", db, now: NOW })).toBeNull();
    expect(notifications).toHaveLength(0);
  });
});

describe("applyStreakGuard uses the remembered clock", () => {
  it("reads the stored offset, so a late-night capture lands on the right day", () => {
    // 2026-07-30T02:00:00Z is still the 29th at 10pm in UTC-4.
    const lateNight = new Date("2026-07-30T02:00:00Z");

    expect(localDayIndex(lateNight, 0)).toBe(localDayIndex(new Date("2026-07-30T12:00:00Z"), 0));
    expect(localDayIndex(lateNight, -240)).toBe(localDayIndex(lateNight, 0) - 1);
  });
});

/* ------------------------------------------------------- timeline sim ------ */

/**
 * The unit tests above check one decision at a time. These run the guard the
 * way production does — once per day, against state it wrote on previous days —
 * over a history with a deliberate gap in it. That is the only way to catch the
 * bugs that live between days: a freeze that refills early, one that gets spent
 * twice on the same gap, or a `longest` that quietly absorbs a day off.
 */
function simulate(args: {
  /** Day 0 is the first day of the simulation. Which days had a capture? */
  captured: (day: number) => boolean;
  days: number;
}) {
  const start = TODAY - args.days;
  const captureDays: number[] = [];
  const prefs: SavedPrefs = { tzOffsetMinutes: 0, streakFrozenDays: [], streakLastFreezeDay: null };
  const notifications: { day: number; body: string }[] = [];

  const db = {
    userPreference: {
      findUnique: async () => ({ ...prefs }),
      upsert: async (q: { update: Partial<SavedPrefs> }) => {
        Object.assign(prefs, q.update);
        return { ...prefs };
      },
    },
    capturedItem: {
      findMany: async () => captureDays.map((d) => ({ capturedAt: new Date(d * DAY_MS + DAY_MS / 2) })),
    },
    user: { findUnique: async () => null },
    notification: {
      create: async (q: { data: { body: string } }) => ({ id: q.data.body }),
    },
  } as unknown as DbClient;

  return (async () => {
    for (let offset = 0; offset <= args.days; offset += 1) {
      const day = start + offset;
      // The sweep runs at the top of the day, before that day's captures.
      const now = new Date(day * DAY_MS + 60_000);
      const held = await applyStreakGuard({ userId: "u1", db, now });
      if (held) notifications.push({ day, body: `held ${held.streak}` });
      if (args.captured(offset)) captureDays.push(day);
    }

    const { current, longest, held } = computeStreaks(captureDays, TODAY, prefs.streakFrozenDays);
    return { current, longest, held, notifications, prefs, captureDays };
  })();
}

describe("day-by-day simulation", () => {
  it("a single missed day is held, and the run continues through it", async () => {
    // 20 days, with day 10 missed.
    const result = await simulate({ days: 20, captured: (d) => d !== 10 });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].body).toBe("held 10");
    expect(result.prefs.streakFrozenDays).toEqual([TODAY - 20 + 10]);

    // 20 real capture days across the window, bridged into one run.
    expect(result.current).toBe(20);
    // And the record counts exactly the days something was saved — not 21.
    expect(result.longest).toBe(20);
    expect(result.held).toBe(1);
  });

  it("a two-day gap is not held, and the streak restarts honestly", async () => {
    // Days 10 and 11 both missed. The first gets frozen; the second cannot be,
    // because the freeze is weekly. The run ends.
    const result = await simulate({ days: 20, captured: (d) => d !== 10 && d !== 11 });

    expect(result.notifications).toHaveLength(1);

    // The run after the gap is what is live now: days 12..20 inclusive.
    expect(result.current).toBe(9);
    // The longest is the protected run before it — 10 real days (0..9) plus
    // nothing for the frozen day. It is never inflated past what was captured.
    expect(result.longest).toBe(10);
    expect(result.current).toBeLessThanOrEqual(result.longest);
  });

  it("an eight-day absence spends the freeze on its first day, then lets go", async () => {
    // Captures on days 0–8, gone for days 9–16, back on day 17.
    //
    // The guard cannot see the future: on the morning of day 10 this is
    // indistinguishable from any other single missed day, so the freeze is
    // spent. Day 11 is missed too, the week's freeze is gone, and the run ends.
    // The freeze is deliberately NOT refunded — the streak genuinely was held
    // on day 10, and unwinding that later would mean retracting something the
    // user was already told.
    const result = await simulate({ days: 20, captured: (d) => d <= 8 || d >= 17 });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].body).toBe("held 9");

    // What matters is that it does not keep the dead run alive. Days 17..20 are
    // the live streak; the 9 days before the absence stand as the record.
    expect(result.current).toBe(4);
    expect(result.longest).toBe(9);
    expect(result.held).toBe(0);
  });

  it("spends nothing for someone who has already been gone a week", async () => {
    // The other half of the same story: by the time a returning user's history
    // is this shape, there is no live run left for a freeze to reach.
    const plan = planStreakFreeze({
      captureDays: run(10, 8),
      frozenDays: [],
      todayIdx: TODAY,
      lastFreezeDay: null,
    });

    expect(plan).toBeNull();
  });

  it("refills weekly — two gaps a week apart are both held", async () => {
    const result = await simulate({ days: 30, captured: (d) => d !== 10 && d !== 18 });

    // The second hold reports 17, not 7: the first freeze bridged day 10, so
    // the run it saved reaches all the way back to the start.
    expect(result.notifications.map((n) => n.body)).toEqual(["held 10", "held 17"]);
    expect(result.current).toBe(29);
    expect(result.longest).toBe(29);
    expect(result.held).toBe(2);
  });

  it("does not refill early — two gaps six days apart get one freeze", async () => {
    // Day 10 frozen; day 16 is six days later, inside the same week.
    const result = await simulate({ days: 30, captured: (d) => d !== 10 && d !== 16 });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].body).toBe("held 10");

    // The run died at day 16 and restarted: days 17..30.
    expect(result.current).toBe(14);
    expect(result.longest).toBe(15);
  });

  it("never announces a hold on a day nothing was missed", async () => {
    const result = await simulate({ days: 30, captured: () => true });

    expect(result.notifications).toHaveLength(0);
    expect(result.current).toBe(31);
    expect(result.longest).toBe(31);
  });
});

/* ------------------------------------------------------------------ fakes -- */

type SavedPrefs = {
  tzOffsetMinutes: number | null;
  streakFrozenDays: number[];
  streakLastFreezeDay: number | null;
};

function fakeDb(args: {
  captureDays: number[];
  tzOffsetMinutes?: number | null;
  frozenDays?: number[];
  lastFreezeDay?: number | null;
}) {
  const notifications: { type: string; title: string; body: string; payload: Record<string, unknown> }[] = [];
  const saved: SavedPrefs = {
    tzOffsetMinutes: args.tzOffsetMinutes ?? null,
    streakFrozenDays: args.frozenDays ?? [],
    streakLastFreezeDay: args.lastFreezeDay ?? null,
  };

  const db = {
    userPreference: {
      findUnique: async () => ({ ...saved }),
      upsert: async (q: { update: Partial<SavedPrefs> }) => {
        Object.assign(saved, q.update);
        return { ...saved };
      },
    },
    capturedItem: {
      // One capture at midday on each day the history says was active.
      findMany: async () =>
        args.captureDays.map((day) => ({ capturedAt: new Date(day * DAY_MS + DAY_MS / 2) })),
    },
    user: {
      findUnique: async () => null,
    },
    notification: {
      create: async (q: {
        data: { type: string; title: string; body: string; payload: Record<string, unknown> };
      }) => {
        notifications.push({
          type: q.data.type,
          title: q.data.title,
          body: q.data.body,
          payload: q.data.payload,
        });
        return { id: `n${notifications.length}` };
      },
    },
  } as unknown as DbClient;

  return { db, notifications, saved };
}
