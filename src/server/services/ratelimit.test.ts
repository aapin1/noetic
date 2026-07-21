import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api";
import type { DbClient } from "@/server/db";
import {
  assertDurableRateLimit,
  clientIp,
  enforceDurableRateLimit,
  enforceRateLimit,
  knownClientIp,
  recordDurableHit,
  resetRateLimits,
  trackedKeyCount,
} from "./ratelimit";

beforeEach(() => {
  resetRateLimits();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("enforceRateLimit", () => {
  it("allows up to the limit, then throws", () => {
    for (let i = 0; i < 3; i++) enforceRateLimit("u-rate", "test-route", 3, 60_000);
    expect(() => enforceRateLimit("u-rate", "test-route", 3, 60_000)).toThrow(AppError);
  });

  it("scopes windows per key and per route", () => {
    for (let i = 0; i < 3; i++) enforceRateLimit("u-a", "iso-route", 3, 60_000);

    expect(() => enforceRateLimit("u-b", "iso-route", 3, 60_000)).not.toThrow();
    expect(() => enforceRateLimit("u-a", "other-route", 3, 60_000)).not.toThrow();
  });

  it("reports a Retry-After hint pointing at the moment a slot frees up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));

    enforceRateLimit("u-retry", "retry-route", 2, 60_000);
    vi.advanceTimersByTime(20_000);
    enforceRateLimit("u-retry", "retry-route", 2, 60_000);

    try {
      enforceRateLimit("u-retry", "retry-route", 2, 60_000);
      expect.unreachable("should have been limited");
    } catch (error) {
      // The oldest hit was 20s ago in a 60s window, so a slot frees in ~40s.
      expect((error as AppError).retryAfterSeconds).toBe(40);
    }
  });

  it("lets the window slide: old hits stop counting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));

    for (let i = 0; i < 3; i++) enforceRateLimit("u-slide", "slide-route", 3, 60_000);
    expect(() => enforceRateLimit("u-slide", "slide-route", 3, 60_000)).toThrow(AppError);

    vi.advanceTimersByTime(61_000);
    expect(() => enforceRateLimit("u-slide", "slide-route", 3, 60_000)).not.toThrow();
  });

  // The regression this module exists to fix: the previous implementation only
  // pruned a key when that same key was hit again, so the map retained an entry
  // per (route, user) seen since boot.
  it("sweeps keys that go idle instead of retaining them forever", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));

    for (let i = 0; i < 500; i++) {
      enforceRateLimit(`one-shot-${i}`, "sweep-route", 5, 60_000);
    }
    expect(trackedKeyCount()).toBe(500);

    // Past the longest window any caller uses, plus a touch to trigger the
    // amortized sweep.
    vi.advanceTimersByTime(2 * 60 * 60_000);
    enforceRateLimit("late", "sweep-route", 5, 60_000);

    expect(trackedKeyCount()).toBe(1);
  });

  it("stays bounded when the sweep cannot keep up", () => {
    // All within one sweep interval, so eviction — not the sweep — is what has
    // to hold the line.
    for (let i = 0; i < 25_000; i++) {
      enforceRateLimit(`flood-${i}`, "flood-route", 5, 60_000);
    }

    expect(trackedKeyCount()).toBeLessThanOrEqual(20_000);
  });
});

describe("durable rate limiting", () => {
  function fakeDb() {
    const rows = new Map<string, number>();

    const db = {
      rateLimitCounter: {
        findUnique: vi.fn(async ({ where }: { where: { key_window: { key: string; window: Date } } }) => {
          const count = rows.get(`${where.key_window.key}@${where.key_window.window.getTime()}`);
          return count === undefined ? null : { count };
        }),
        upsert: vi.fn(async ({ where }: { where: { key_window: { key: string; window: Date } } }) => {
          const id = `${where.key_window.key}@${where.key_window.window.getTime()}`;
          const next = (rows.get(id) ?? 0) + 1;
          rows.set(id, next);
          return { count: next };
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };

    return { db: db as unknown as DbClient, rows, spies: db.rateLimitCounter };
  }

  it("throws once the window's budget is spent", async () => {
    const { db } = fakeDb();

    for (let i = 0; i < 3; i++) {
      await enforceDurableRateLimit("auth:ip:1.2.3.4", 3, 60_000, db);
    }

    await expect(enforceDurableRateLimit("auth:ip:1.2.3.4", 3, 60_000, db)).rejects.toThrow(AppError);
  });

  it("separates the check from the charge, so successes need not be counted", async () => {
    const { db } = fakeDb();

    // Three recorded failures against a limit of 3 exhausts the budget...
    for (let i = 0; i < 3; i++) await recordDurableHit("auth:id:someone", 60_000, db);
    await expect(assertDurableRateLimit("auth:id:someone", 3, 60_000, db)).rejects.toThrow(AppError);

    // ...while a key that was only ever checked, never charged, stays open.
    await expect(assertDurableRateLimit("auth:id:untouched", 3, 60_000, db)).resolves.toBeUndefined();
  });

  it("starts a fresh bucket in the next fixed window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));
    const { db } = fakeDb();

    for (let i = 0; i < 3; i++) await enforceDurableRateLimit("auth:ip:5.6.7.8", 3, 60_000, db);
    await expect(enforceDurableRateLimit("auth:ip:5.6.7.8", 3, 60_000, db)).rejects.toThrow(AppError);

    vi.advanceTimersByTime(61_000);
    await expect(enforceDurableRateLimit("auth:ip:5.6.7.8", 3, 60_000, db)).resolves.toBeUndefined();
  });

  // A limiter that takes the site down when the database hiccups is a worse
  // outage than the abuse it prevents.
  it("fails open when the counter store is unavailable", async () => {
    const db = {
      rateLimitCounter: {
        findUnique: vi.fn(async () => {
          throw new Error("connection terminated");
        }),
        upsert: vi.fn(async () => {
          throw new Error("connection terminated");
        }),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as DbClient;

    await expect(enforceDurableRateLimit("auth:ip:9.9.9.9", 1, 60_000, db)).resolves.toBeUndefined();
  });
});

describe("clientIp", () => {
  function requestWith(headers: Record<string, string>) {
    return new Request("http://localhost/api/thing", { headers });
  }

  it("takes the leftmost x-forwarded-for entry as the client", () => {
    const ip = clientIp(requestWith({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("handles a single-entry header", () => {
    expect(clientIp(requestWith({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(requestWith({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("degrades to a constant when no proxy header is present", () => {
    // The auth routes accept this lumping: over-limiting sign-in attempts errs
    // in the safe direction.
    expect(clientIp(requestWith({}))).toBe("unknown");
  });
});

describe("knownClientIp", () => {
  function requestWith(headers: Record<string, string>) {
    return new Request("http://localhost/api/thing", { headers });
  }

  it("reports the address when a proxy header identifies one", () => {
    expect(knownClientIp(requestWith({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })))
      .toBe("203.0.113.9");
    expect(knownClientIp(requestWith({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  // Lumping every caller into one bucket would turn a missing header into a
  // global outage — strictly worse than leaving the route unlimited, which is
  // where it stands today.
  it("reports null rather than a shared bucket when no header identifies one", () => {
    expect(knownClientIp(requestWith({}))).toBeNull();
    expect(knownClientIp(requestWith({ "x-forwarded-for": "" }))).toBeNull();
  });
});
