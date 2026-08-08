import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { updatePreferences } from "@/server/services/preferences";
import { updatePreferencesSchema } from "@/server/contracts";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function fakeDb() {
  const upsert = vi.fn(async (args: unknown) => args);
  return { db: { userPreference: { upsert } } as unknown as DbClient, upsert };
}

describe("updatePreferences", () => {
  it("writes only the columns the caller named, leaving the rest alone", async () => {
    const { db, upsert } = fakeDb();

    await updatePreferences({ userId: "u1", pushResurface: false, db });

    const args = upsert.mock.calls[0][0] as {
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    };
    expect(args.update.pushResurface).toBe(false);
    expect(args.update.pushSocial).toBeUndefined();
    expect(args.update.pushStreak).toBeUndefined();
    expect(args.update.quietHoursStartHour).toBeUndefined();
    expect(args.update.quietHoursEndHour).toBeUndefined();
    expect(args.update.insightStyle).toBeUndefined();
    expect(args.update.preferences).toBeUndefined();
  });

  it("updates quiet hours without touching the category toggles", async () => {
    const { db, upsert } = fakeDb();

    await updatePreferences({ userId: "u1", quietHoursStartHour: 22, quietHoursEndHour: 8, db });

    const args = upsert.mock.calls[0][0] as { update: Record<string, unknown> };
    expect(args.update.quietHoursStartHour).toBe(22);
    expect(args.update.quietHoursEndHour).toBe(8);
    expect(args.update.pushSocial).toBeUndefined();
    expect(args.update.pushResurface).toBeUndefined();
    expect(args.update.pushStreak).toBeUndefined();
  });
});

describe("updatePreferencesSchema", () => {
  it("accepts a single toggle on its own", () => {
    expect(updatePreferencesSchema.parse({ pushStreak: false })).toEqual({ pushStreak: false });
  });

  it("accepts hours across the whole 0–23 range", () => {
    expect(
      updatePreferencesSchema.parse({ quietHoursStartHour: 0, quietHoursEndHour: 23 }),
    ).toEqual({ quietHoursStartHour: 0, quietHoursEndHour: 23 });
  });

  it("rejects an empty patch", () => {
    expect(() => updatePreferencesSchema.parse({})).toThrow();
  });

  it("rejects hours outside 0–23 and fractional hours", () => {
    expect(() => updatePreferencesSchema.parse({ quietHoursStartHour: 24 })).toThrow();
    expect(() => updatePreferencesSchema.parse({ quietHoursEndHour: -1 })).toThrow();
    expect(() => updatePreferencesSchema.parse({ quietHoursStartHour: 9.5 })).toThrow();
  });
});
