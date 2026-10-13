import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { runNotificationJob } from "@/server/services/notification-job";
import { localDayIndex } from "@/server/services/streak";

/**
 * The hourly tick. What is worth pinning here is not the selection logic — that
 * is tested in resurface/streak — but the properties the *schedule* depends on:
 * that an idle hour is nearly free, that two runs cannot overlap, that a
 * thrown run still reports itself, and that every run leaves exactly one
 * structured line behind.
 */

const NOW = new Date("2026-07-30T12:00:00Z");

type Counts = Record<string, number>;

/**
 * A database where every read is counted and returns nothing — the shape of an
 * hour with nobody due and no queue.
 */
function idleDb() {
  const queries: Counts = {};
  const count = (name: string) => {
    queries[name] = (queries[name] ?? 0) + 1;
  };

  const leases: { name: string; heldUntil: Date; heldBy: string }[] = [];

  const db = {
    jobLease: {
      updateMany: async (args: {
        where: { name: string; heldUntil?: { lte: Date }; heldBy?: string };
        data: Record<string, unknown>;
      }) => {
        count("lease.updateMany");
        const row = leases.find((l) => l.name === args.where.name);
        if (!row) return { count: 0 };
        if (args.where.heldUntil && row.heldUntil > args.where.heldUntil.lte) return { count: 0 };
        if (args.where.heldBy !== undefined && row.heldBy !== args.where.heldBy) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
      create: async (args: { data: { name: string; heldUntil: Date; heldBy: string } }) => {
        count("lease.create");
        if (leases.some((l) => l.name === args.data.name)) throw new Error("unique violation");
        leases.push({ ...args.data });
        return args.data;
      },
    },
    user: {
      findMany: async () => {
        count("user.findMany");
        return [];
      },
    },
    notification: {
      findMany: async () => {
        count("notification.findMany");
        return [];
      },
      updateMany: async () => ({ count: 0 }),
      groupBy: async () => [],
    },
    userPreference: { findMany: async () => [] },
    deviceToken: { updateMany: async () => ({ count: 0 }) },
  } as unknown as DbClient;

  return { db, queries, leases };
}

/** A console spy, reduced to the two things this file uses. */
type ConsoleSpy = { mock: { calls: unknown[][] }; mockRestore: () => void };

/** The one structured line each run emits, parsed back. */
function loggedRuns(spy: ConsoleSpy) {
  return spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry?.event === "notifications_cron");
}

let errorSpy: ConsoleSpy;
const originalFetch = global.fetch;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  global.fetch = originalFetch;
});

describe("an hour with nothing to do", () => {
  it("makes no outbound request", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    const { db } = idleDb();

    await runNotificationJob({ db, now: NOW });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("costs two indexed reads and two single-row lease writes", async () => {
    // The budget the hourly schedule is priced against. If this grows, an idle
    // hour is no longer free and 24 runs a day stop being obviously fine.
    const { db, queries } = idleDb();

    await runNotificationJob({ db, now: NOW });

    expect(queries["user.findMany"]).toBe(1);
    expect(queries["notification.findMany"]).toBe(1);
    // Acquire (create, first run) and release.
    expect((queries["lease.create"] ?? 0) + (queries["lease.updateMany"] ?? 0)).toBe(3);
  });

  it("does not query per sweep — both take their candidates from the one read", async () => {
    const { db, queries } = idleDb();

    await runNotificationJob({ db, now: NOW });

    // Two sweeps, one user query between them.
    expect(queries["user.findMany"]).toBe(1);
  });
});

describe("running twice in one hour", () => {
  it("does nothing the second time round", async () => {
    const { db, queries } = idleDb();

    await runNotificationJob({ db, now: NOW });
    const afterFirst = queries["user.findMany"];

    await runNotificationJob({ db, now: new Date(NOW.getTime() + 5 * 60_000) });

    // The lease is released at the end of a run, so the second call does
    // acquire it — and the per-user daily caps inside the sweeps are what make
    // it queue nothing. Both mechanisms are load-bearing: the lease stops
    // concurrent runs, the caps stop sequential ones.
    expect(queries["user.findMany"]).toBe(afterFirst + 1);
    expect(loggedRuns(errorSpy)).toHaveLength(2);
  });

  it("stands down entirely when a run is already in flight", async () => {
    const { db, queries } = idleDb();

    // Two ticks at once, as an overrunning run and its successor.
    const [first, second] = await Promise.all([
      runNotificationJob({ db, now: NOW }),
      runNotificationJob({ db, now: NOW }),
    ]);

    expect([first.ran, second.ran].filter(Boolean)).toHaveLength(1);
    // Only the winner read anything.
    expect(queries["user.findMany"]).toBe(1);
  });
});

describe("the run log", () => {
  it("emits exactly one structured line, whatever happened", async () => {
    const { db } = idleDb();

    await runNotificationJob({ db, now: NOW });

    const runs = loggedRuns(errorSpy);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      event: "notifications_cron",
      ran: true,
      considered: 0,
      queued: 0,
      sent: 0,
      failed: 0,
      held: 0,
      suppressed: false,
    });
    expect(typeof runs[0].ms).toBe("number");
  });

  it("still reports a run that threw, rather than vanishing", async () => {
    const { db } = idleDb();
    vi.spyOn(db.user, "findMany").mockRejectedValue(new Error("connection refused"));

    // And it does not throw into the caller: the endpoint answers rather than
    // handing curl a 500 it might be configured to retry.
    await expect(runNotificationJob({ db, now: NOW })).resolves.toMatchObject({ ran: false });

    const runs = loggedRuns(errorSpy);
    expect(runs).toHaveLength(1);
    expect(runs[0].error).toBe("connection refused");
  });

  it("frees the lease after a thrown run, so the next hour still works", async () => {
    const { db } = idleDb();
    const failing = vi.spyOn(db.user, "findMany").mockRejectedValue(new Error("boom"));

    await runNotificationJob({ db, now: NOW });
    failing.mockRestore();

    const next = await runNotificationJob({ db, now: new Date(NOW.getTime() + 3600_000) });
    expect(next.ran).toBe(true);
  });
});

/**
 * A tick with real users on it, at a UTC hour that is 9am for one offset and
 * 7pm for another — both are due at once, on different sweeps.
 */
const SIXTEEN_UTC = new Date("2026-07-30T16:00:00Z");
const DAY_MS = 86_400_000;
const MORNING_TZ = -420; // 9am
const EVENING_TZ = 180; // 7pm

type DueUser = {
  id: string;
  tzOffsetMinutes: number | null;
  pushStreak?: boolean;
  /** Days of a run ending yesterday, in the user's local days. */
  run: number;
  tokens?: number;
  emailNudges?: boolean;
  /** Days since signup. Defaults to well past every first-capture email rung's start. */
  signedUpDaysAgo?: number;
};

function busyDb(users: DueUser[]) {
  const { db, queries, leases } = idleDb();
  const notifications: { recipientId: string; type: string; createdAt: Date }[] = [];
  const byId = new Map(users.map((u) => [u.id, u]));

  const captureDays = (u: DueUser) => {
    const today = localDayIndex(SIXTEEN_UTC, u.tzOffsetMinutes ?? 0);
    return Array.from({ length: u.run }, (_, i) => today - 1 - i);
  };
  const capturedAtFor = (u: DueUser) =>
    captureDays(u).map((day) => ({
      // Midday local, expressed as an instant.
      capturedAt: new Date(day * DAY_MS - (u.tzOffsetMinutes ?? 0) * 60_000 + DAY_MS / 2),
      id: `c-${day}`,
      rawText: null,
      contentItem: null,
      topics: [],
    }));

  Object.assign(db, {
    user: {
      findMany: async () => {
        queries["user.findMany"] = (queries["user.findMany"] ?? 0) + 1;
        return users.map((u) => ({
          id: u.id,
          email: `${u.id}@x.test`,
          name: null,
          createdAt: new Date(SIXTEEN_UTC.getTime() - (u.signedUpDaysAgo ?? 2) * DAY_MS),
          preference: {
            pushResurface: true,
            pushStreak: u.pushStreak ?? true,
            emailNudges: u.emailNudges ?? true,
            tzOffsetMinutes: u.tzOffsetMinutes,
          },
          deviceTokens: Array.from({ length: u.tokens ?? 1 }, (_, i) => ({ id: `t${i}` })),
          capturedItems: capturedAtFor(u).slice(0, 1),
        }));
      },
      findUnique: async () => null,
    },
    userPreference: {
      findMany: async () => [],
      findUnique: async (q: { where: { userId: string } }) => {
        const u = byId.get(q.where.userId)!;
        return {
          tzOffsetMinutes: u.tzOffsetMinutes,
          streakFrozenDays: [],
          streakLastFreezeDay: null,
          streakActivityDays: [],
          pushStreak: u.pushStreak ?? true,
        };
      },
      upsert: async () => ({}),
    },
    capturedItem: {
      findMany: async (q: { where: { userId: string } }) => capturedAtFor(byId.get(q.where.userId)!),
    },
    memoryEdge: { findMany: async () => [] },
    positionChallenge: { findFirst: async () => null },
    notification: {
      findMany: async () => [],
      findFirst: async (q: { where: { recipientId: string; type?: string | { in: string[] }; createdAt?: { gte: Date } } }) => {
        const types = typeof q.where.type === "string" ? [q.where.type] : q.where.type?.in;
        const hit = notifications.find(
          (n) => n.recipientId === q.where.recipientId
            && (!types || types.includes(n.type))
            && (!q.where.createdAt || n.createdAt >= q.where.createdAt.gte),
        );
        return hit ? { id: "existing" } : null;
      },
      create: async (q: { data: { recipientId: string; type: string } }) => {
        notifications.push({ recipientId: q.data.recipientId, type: q.data.type, createdAt: SIXTEEN_UTC });
        return { id: `n${notifications.length}` };
      },
      updateMany: async () => ({ count: 0 }),
      groupBy: async () => [],
    },
  });

  return { db, queries, leases, notifications };
}

describe("the evening hour", () => {
  it("reminds the users for whom it is 7pm, and only them, in the same read", async () => {
    const { db, queries, notifications } = busyDb([
      { id: "evening", tzOffsetMinutes: EVENING_TZ, run: 5 },
      { id: "morning", tzOffsetMinutes: MORNING_TZ, run: 5 },
    ]);

    const result = await runNotificationJob({ db, now: SIXTEEN_UTC });

    expect(result.due).toBe(2);
    expect(result.streakRisk).toEqual({ considered: 1, queued: 1 });
    expect(notifications.filter((n) => n.type === "STREAK_AT_RISK").map((n) => n.recipientId))
      .toEqual(["evening"]);
    // Still one user read: the two hours are split from the offset, not queried twice.
    expect(queries["user.findMany"]).toBe(1);
  });

  it("does not run the morning sweeps on the evening's users", async () => {
    const { db, notifications } = busyDb([
      { id: "evening", tzOffsetMinutes: EVENING_TZ, run: 5 },
    ]);

    const result = await runNotificationJob({ db, now: SIXTEEN_UTC });

    expect(result.streak.considered).toBe(0);
    expect(result.resurface.considered).toBe(0);
    expect(notifications.every((n) => n.type === "STREAK_AT_RISK")).toBe(true);
  });

  it("skips the reminder for anyone who muted streak pushes or has no device", async () => {
    const { db, notifications } = busyDb([
      { id: "muted", tzOffsetMinutes: EVENING_TZ, run: 5, pushStreak: false },
      { id: "no-device", tzOffsetMinutes: EVENING_TZ, run: 5, tokens: 0 },
      { id: "short", tzOffsetMinutes: EVENING_TZ, run: 2 },
    ]);

    const result = await runNotificationJob({ db, now: SIXTEEN_UTC });

    // Only the short run is even looked at; it is not long enough to remind.
    expect(result.streakRisk).toEqual({ considered: 1, queued: 0 });
    expect(notifications).toHaveLength(0);
  });

  it("counts the evening's work in the run log", async () => {
    const { db } = busyDb([{ id: "evening", tzOffsetMinutes: EVENING_TZ, run: 5 }]);

    await runNotificationJob({ db, now: SIXTEEN_UTC });

    expect(loggedRuns(errorSpy)[0]).toMatchObject({ due: 1, considered: 1, queued: 1 });
  });
});

describe("the first-capture email", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.DATABASE_URL ??= "postgres://unit";
    process.env.DIRECT_URL ??= "postgres://unit";
    process.env.NEXTAUTH_URL ??= "https://mneme.test";
    process.env.NEXTAUTH_SECRET ??= "unit-test-secret-value";
    process.env.MNEME_BASE_URL ??= "https://mneme.test";
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  /** Recipients of every email the run handed to Resend. */
  function resendRecipients(fetchMock: { mock: { calls: unknown[][] } }) {
    return fetchMock.mock.calls
      .filter(([url]) => String(url).includes("api.resend.com"))
      .map(([, init]) => (JSON.parse((init as { body: string }).body) as { to: string[] }).to[0]);
  }

  it("emails only morning accounts with no captures, no push token, and email left on", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    global.fetch = fetchMock as never;
    const { db } = busyDb([
      { id: "fresh", tzOffsetMinutes: MORNING_TZ, run: 0, tokens: 0 },
      { id: "has-token", tzOffsetMinutes: MORNING_TZ, run: 0, tokens: 1 },
      { id: "has-capture", tzOffsetMinutes: MORNING_TZ, run: 2, tokens: 0 },
      { id: "unsubscribed", tzOffsetMinutes: MORNING_TZ, run: 0, tokens: 0, emailNudges: false },
      { id: "evening", tzOffsetMinutes: EVENING_TZ, run: 0, tokens: 0 },
    ]);

    const result = await runNotificationJob({ db, now: SIXTEEN_UTC });

    expect(resendRecipients(fetchMock)).toEqual(["fresh@x.test"]);
    expect(result.firstCaptureEmail.sent).toBe(1);
    expect(loggedRuns(errorSpy)[0]?.emailed).toBe(1);
  });

  it("sends nothing and claims nothing when email is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    const { db, notifications } = busyDb([{ id: "fresh", tzOffsetMinutes: MORNING_TZ, run: 0, tokens: 0 }]);

    await runNotificationJob({ db, now: SIXTEEN_UTC });

    expect(resendRecipients(fetchMock)).toEqual([]);
    expect(notifications).toHaveLength(0);
  });
});
