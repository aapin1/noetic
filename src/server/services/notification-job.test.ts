import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { runNotificationJob } from "@/server/services/notification-job";

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
