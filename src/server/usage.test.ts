import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import {
  consumeUsageOrThrow,
  enforceRateLimit,
  hasUsageRemaining,
  tryConsumeUsage,
  USAGE_CAPS,
} from "@/server/services/usage";
import type { DbClient } from "@/server/db";

/** In-memory stand-in for the two tables the usage service touches. */
function fakeDb(opts: { plan?: "FREE" | "PLUS"; counts?: Record<string, number> } = {}) {
  const counters = new Map<string, number>(Object.entries(opts.counts ?? {}));
  const key = (w: { userId: string; kind: string; period: string }) =>
    `${w.userId}:${w.kind}:${w.period}`;

  const db = {
    user: {
      findUnique: async () => ({ plan: opts.plan ?? "FREE" }),
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
