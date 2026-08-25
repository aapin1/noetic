import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import { afterEach, beforeEach, vi } from "vitest";
import {
  consumeUsageOrThrow,
  enforceRateLimit,
  getUsageSummary,
  hasUsageRemaining,
  periodResetsAt,
  tryConsumeUsage,
  usageLimitNotice,
  USAGE_CAPS,
} from "@/server/services/usage";
import type { DbClient } from "@/server/db";

/** In-memory stand-in for the two tables the usage service touches. */
function fakeDb(opts: { plan?: "FREE" | "PLUS"; counts?: Record<string, number>; tzOffsetMinutes?: number } = {}) {
  const counters = new Map<string, number>(Object.entries(opts.counts ?? {}));
  const key = (w: { userId: string; kind: string; period: string }) =>
    `${w.userId}:${w.kind}:${w.period}`;

  const db = {
    user: {
      findUnique: async () => ({ plan: opts.plan ?? "FREE" }),
    },
    userPreference: {
      findUnique: async () => (opts.tzOffsetMinutes === undefined ? null : { tzOffsetMinutes: opts.tzOffsetMinutes }),
    },
    usageCounter: {
      upsert: async ({ where }: { where: { userId_kind_period: { userId: string; kind: string; period: string } } }) => {
        const k = key(where.userId_kind_period);
        if (!counters.has(k)) counters.set(k, 0);
        return { ...where.userId_kind_period, count: counters.get(k)! };
      },
      update: async ({ where }: { where: { userId_kind_period: { userId: string; kind: string; period: string } } }) => {
        const k = key(where.userId_kind_period);
        counters.set(k, (counters.get(k) ?? 0) + 1);
        return { ...where.userId_kind_period, count: counters.get(k)! };
      },
      findUnique: async ({ where }: { where: { userId_kind_period: { userId: string; kind: string; period: string } } }) => {
        const k = key(where.userId_kind_period);
        return counters.has(k) ? { count: counters.get(k)! } : null;
      },
      findMany: async () => [],
    },
  } as unknown as DbClient;

  return { db, counters };
}

const monthKey = new Date().toISOString().slice(0, 7);
const dayKey = new Date().toISOString().slice(0, 10);

describe("tryConsumeUsage", () => {
  it("allows and increments under the cap", async () => {
    const { db, counters } = fakeDb();
    await expect(tryConsumeUsage("u1", "image_describe", db)).resolves.toBe(true);
    expect(counters.get(`u1:image_describe:${monthKey}`)).toBe(1);
  });

  it("blocks a FREE user at the cap without consuming", async () => {
    const { db, counters } = fakeDb({
      counts: { [`u1:image_describe:${monthKey}`]: USAGE_CAPS.image_describe.free },
    });
    await expect(tryConsumeUsage("u1", "image_describe", db)).resolves.toBe(false);
    expect(counters.get(`u1:image_describe:${monthKey}`)).toBe(USAGE_CAPS.image_describe.free);
  });

  it("always allows a PLUS user, still counting for telemetry", async () => {
    const { db, counters } = fakeDb({
      plan: "PLUS",
      counts: { [`u1:image_describe:${monthKey}`]: USAGE_CAPS.image_describe.free + 50 },
    });
    await expect(tryConsumeUsage("u1", "image_describe", db)).resolves.toBe(true);
    expect(counters.get(`u1:image_describe:${monthKey}`)).toBe(USAGE_CAPS.image_describe.free + 51);
  });

  it("keys daily kinds by day, not month", async () => {
    const { db, counters } = fakeDb();
    await tryConsumeUsage("u1", "companion_message", db);
    expect(counters.get(`u1:companion_message:${dayKey}`)).toBe(1);
  });
});

describe("hasUsageRemaining", () => {
  it("peeks without incrementing", async () => {
    const { db, counters } = fakeDb();
    await expect(hasUsageRemaining("u1", "social_video_transcript", db)).resolves.toBe(true);
    expect(counters.size).toBe(0);
  });

  it("reports exhaustion at the cap", async () => {
    const { db } = fakeDb({
      counts: { [`u1:social_video_transcript:${monthKey}`]: USAGE_CAPS.social_video_transcript.free },
    });
    await expect(hasUsageRemaining("u1", "social_video_transcript", db)).resolves.toBe(false);
  });
});

describe("consumeUsageOrThrow", () => {
  it("throws a 429 AppError with the user-facing message at the cap", async () => {
    const { db } = fakeDb({
      counts: { [`u1:companion_message:${dayKey}`]: USAGE_CAPS.companion_message.free },
    });
    await expect(consumeUsageOrThrow("u1", "companion_message", db)).rejects.toMatchObject({
      code: "USAGE_LIMIT",
      status: 429,
    });
  });
});

describe("enforceRateLimit", () => {
  it("throws after the window limit is exceeded", () => {
    for (let i = 0; i < 3; i++) enforceRateLimit("u-rate", "test-route", 3, 60_000);
    expect(() => enforceRateLimit("u-rate", "test-route", 3, 60_000)).toThrow(AppError);
  });

  it("tracks users independently", () => {
    for (let i = 0; i < 3; i++) enforceRateLimit("u-a", "iso-route", 3, 60_000);
    expect(() => enforceRateLimit("u-b", "iso-route", 3, 60_000)).not.toThrow();
  });
});

describe("periods run on the user's clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 23:30 UTC on Aug 31: still Aug 31 in New York (UTC-4), already Sep 1 in Berlin (UTC+2).
    vi.setSystemTime(new Date("2026-08-31T23:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keys the month by the user's local date, not UTC", async () => {
    const { db: ny, counters: nyCounters } = fakeDb({ tzOffsetMinutes: -240 });
    await tryConsumeUsage("u1", "voice_transcription", ny);
    expect([...nyCounters.keys()]).toEqual(["u1:voice_transcription:2026-08"]);

    const { db: berlin, counters: berlinCounters } = fakeDb({ tzOffsetMinutes: 120 });
    await tryConsumeUsage("u1", "voice_transcription", berlin);
    expect([...berlinCounters.keys()]).toEqual(["u1:voice_transcription:2026-09"]);
  });

  it("a cap reached in August is clear again at the user's own midnight on Sep 1", async () => {
    const { db } = fakeDb({ tzOffsetMinutes: -240, counts: { "u1:voice_transcription:2026-08": USAGE_CAPS.voice_transcription.free } });
    await expect(hasUsageRemaining("u1", "voice_transcription", db)).resolves.toBe(false);
    vi.setSystemTime(new Date("2026-09-01T03:59:00.000Z")); // 23:59 Aug 31 in New York
    await expect(hasUsageRemaining("u1", "voice_transcription", db)).resolves.toBe(false);
    vi.setSystemTime(new Date("2026-09-01T04:00:00.000Z")); // 00:00 Sep 1 in New York
    await expect(hasUsageRemaining("u1", "voice_transcription", db)).resolves.toBe(true);
  });

  it("computes the reset instant on the user's clock", () => {
    expect(periodResetsAt("month", -240).toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(periodResetsAt("month", 120).toISOString()).toBe("2026-09-30T22:00:00.000Z"); // Berlin is already in September
    expect(periodResetsAt("day", -240).toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(periodResetsAt("month", 0).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("the notice says what ran out, when it resets, and the upsell", () => {
    const notice = usageLimitNotice("social_video_transcript", -240);
    expect(notice.message).toBe(
      "You've used this month's 3 deep reads of TikTok and Instagram videos, so this one was saved with its caption only. Resets Sep 1. Mneme Plus makes them unlimited.",
    );
    expect(notice.resetsAt).toBe("2026-09-01T04:00:00.000Z");
    expect(usageLimitNotice("companion_message", -240).message).toContain("Resets tomorrow.");
  });

  it("the 429 carries the dated notice and the summary carries resetsAt", async () => {
    const { db } = fakeDb({ tzOffsetMinutes: -240, counts: { "u1:companion_message:2026-08-31": USAGE_CAPS.companion_message.free } });
    await expect(consumeUsageOrThrow("u1", "companion_message", db)).rejects.toMatchObject({
      code: "USAGE_LIMIT",
      status: 429,
      message: expect.stringContaining("Resets tomorrow."),
      issues: expect.objectContaining({ kind: "companion_message", resetsAt: "2026-09-01T04:00:00.000Z" }),
    });
    const summary = await getUsageSummary("u1", db);
    expect(summary.find((m) => m.kind === "voice_transcription")?.resetsAt).toBe("2026-09-01T04:00:00.000Z");
  });
});
