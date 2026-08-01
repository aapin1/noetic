import { NotificationStatus, NotificationType, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runNotificationJob } from "@/server/services/notification-job";
import { DAILY_SEND_HOUR } from "@/server/services/notification-policy";

/**
 * The notification pipeline end to end, against a real Postgres.
 *
 * This exists because the unit tests run on a fake db, and a fake db cannot
 * catch a malformed query. `dueThisHourWhere` builds an actual Prisma
 * `UserWhereInput` out of relation filters and a null branch; if that is wrong
 * it throws at runtime and every fake-db test still passes. Same for the
 * lease's conditional UPDATE, whose whole value is that Postgres serialises it.
 *
 * Needs the test database up: `npm run db:up`, then `npm run test:integration`.
 */

const db = new PrismaClient();
const DAY = 86_400_000;

/** An instant at which it is exactly DAILY_SEND_HOUR in UTC. */
function sendHourUtc(dayOffset = 0): Date {
  const base = Date.UTC(2026, 6, 30, DAILY_SEND_HOUR, 5, 0);
  return new Date(base + dayOffset * DAY);
}

async function reset() {
  await db.notification.deleteMany();
  await db.deviceToken.deleteMany();
  await db.capturedItem.deleteMany();
  await db.userPreference.deleteMany();
  await db.jobLease.deleteMany();
  await db.user.deleteMany();
}

/**
 * A user with a live run of `streakDays` real capture days ending the day
 * before yesterday — i.e. yesterday was missed and is exactly what a freeze
 * exists to bridge.
 */
async function seedUser(args: {
  id: string;
  now: Date;
  streakDays: number;
  withToken?: boolean;
  prefs?: Record<string, unknown>;
}) {
  await db.user.create({ data: { id: args.id, email: `${args.id}@example.test` } });
  await db.userPreference.create({
    data: { userId: args.id, tzOffsetMinutes: 0, ...(args.prefs ?? {}) },
  });
  if (args.withToken !== false) {
    await db.deviceToken.create({
      data: {
        userId: args.id,
        token: `ExponentPushToken[${args.id}]`,
        platform: "IOS",
        provider: "EXPO",
      },
    });
  }

  // Days -2 back through -(streakDays+1): a run ending the day before yesterday.
  const rows = [];
  for (let i = 0; i < args.streakDays; i += 1) {
    const day = i + 2;
    rows.push({
      userId: args.id,
      kind: "TEXT" as const,
      rawText: `capture ${args.id} ${i}`,
      terms: [],
      capturedAt: new Date(args.now.getTime() - day * DAY),
    });
  }
  // One capture a month back, so the resurfacing engine has something true to
  // say (the anniversary tier). Without it the corpus is a bare streak and
  // selection correctly returns null, which would make the arbitration test
  // pass for the wrong reason.
  rows.push({
    userId: args.id,
    kind: "TEXT" as const,
    rawText: `a thought ${args.id} kept`,
    terms: [],
    capturedAt: new Date(args.now.getTime() - 30 * DAY),
  });

  await db.capturedItem.createMany({ data: rows });
}

beforeEach(async () => {
  await reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Expo, accepting everything. Nothing here reaches the network.
  global.fetch = vi.fn(async (_u: unknown, init?: { body?: string }) => ({
    ok: true,
    json: async () => ({
      data: (JSON.parse(String(init?.body ?? "[]")) as unknown[]).map(() => ({ status: "ok" })),
    }),
  })) as never;
});

afterAll(async () => {
  await reset();
  await db.$disconnect();
});

describe("the hourly job against a real database", () => {
  it("selects only the users for whom it is locally the send hour", async () => {
    const now = sendHourUtc();
    // Due: UTC. Not due: UTC+3, for whom it is already midday.
    await seedUser({ id: "due", now, streakDays: 12 });
    await seedUser({ id: "notdue", now, streakDays: 12, prefs: { tzOffsetMinutes: 180 } });

    const result = await runNotificationJob({ db, now });

    expect(result.ran).toBe(true);
    expect(result.due).toBe(1);
    expect(result.streak.held).toBe(1);

    const held = await db.notification.findMany({ where: { type: NotificationType.STREAK_HELD } });
    expect(held).toHaveLength(1);
    expect(held[0].recipientId).toBe("due");
  });

  it("holds the streak and skips resurfacing, which stays eligible tomorrow", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "u1", now, streakDays: 12 });

    const first = await runNotificationJob({ db, now });
    expect(first.streak.held).toBe(1);
    // Streak beat resurfacing, so nothing resurfacing was even selected.
    expect(first.resurface.queued).toBe(0);

    const afterDayOne = await db.notification.findMany();
    expect(afterDayOne.map((n) => n.type)).toEqual([NotificationType.STREAK_HELD]);
    expect(afterDayOne[0].status).toBe(NotificationStatus.SENT);

    // `Notification.createdAt` defaults to the DATABASE's clock, not the `now`
    // injected here — so a row written during the simulated day 0 carries a real
    // timestamp and still looks fresh to day 1's arbitration window. Real runs
    // never see this (there, the two clocks are the same one); a test that
    // travels a day has to say so explicitly.
    await db.notification.updateMany({ data: { createdAt: now } });

    // The next day: the streak is not held again (weekly refill), and the
    // resurfacing candidate that yielded is still available.
    const tomorrow = sendHourUtc(1);
    const second = await runNotificationJob({ db, now: tomorrow });

    expect(second.streak.held).toBe(0);
    expect(second.resurface.queued).toBe(1);
  });

  it("applies the freeze to a user with no push token, who simply is not told", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "silent", now, streakDays: 12, withToken: false });

    const result = await runNotificationJob({ db, now });

    expect(result.streak.held).toBe(1);
    // The freeze is persisted — that is the part that matters.
    const prefs = await db.userPreference.findUnique({ where: { userId: "silent" } });
    expect(prefs?.streakFrozenDays).toHaveLength(1);
    // The notification is terminal rather than lingering PENDING.
    const notif = await db.notification.findFirst({ where: { recipientId: "silent" } });
    expect(notif?.status).toBe(NotificationStatus.FAILED);
  });

  it("freezes the streak even for a user who muted streak notifications", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "muted", now, streakDays: 12, prefs: { pushStreak: false } });

    const result = await runNotificationJob({ db, now });

    expect(result.streak.held).toBe(1);
    const prefs = await db.userPreference.findUnique({ where: { userId: "muted" } });
    expect(prefs?.streakFrozenDays).toHaveLength(1);
    const notif = await db.notification.findFirst({ where: { recipientId: "muted" } });
    expect(notif?.status).toBe(NotificationStatus.FAILED);
  });

  it("holds through quiet hours and delivers in the next eligible hour", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "u1", now, streakDays: 12 });
    // Quiet for exactly the send hour — [9, 10). The sweep still runs (it is
    // gated on the local hour, not on quiet hours), so the notification is
    // created and then held at the wire.
    await db.userPreference.update({
      where: { userId: "u1" },
      data: { quietHoursStartHour: DAILY_SEND_HOUR, quietHoursEndHour: DAILY_SEND_HOUR + 1 },
    });

    const first = await runNotificationJob({ db, now });
    expect(first.dispatch.held).toBe(1);
    expect(first.dispatch.sent).toBe(0);

    let notif = await db.notification.findFirstOrThrow();
    expect(notif.status).toBe(NotificationStatus.PENDING);

    // One hour later the window has opened.
    const later = await runNotificationJob({ db, now: new Date(now.getTime() + 3600_000) });
    expect(later.dispatch.sent).toBe(1);

    notif = await db.notification.findFirstOrThrow();
    expect(notif.status).toBe(NotificationStatus.SENT);
  });

  it("queues nothing on a second run inside the same hour", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "u1", now, streakDays: 12 });

    await runNotificationJob({ db, now });
    const afterFirst = await db.notification.count();

    const second = await runNotificationJob({ db, now: new Date(now.getTime() + 120_000) });

    expect(second.streak.held).toBe(0);
    expect(second.resurface.queued).toBe(0);
    expect(await db.notification.count()).toBe(afterFirst);
  });

  it("lets only one of two concurrent runs through", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "u1", now, streakDays: 12 });

    const [a, b] = await Promise.all([
      runNotificationJob({ db, now }),
      runNotificationJob({ db, now }),
    ]);

    expect([a.ran, b.ran].filter(Boolean)).toHaveLength(1);
    expect(await db.notification.count()).toBe(1);
  });

  it("transmits nothing under the kill switch, and leaves nothing PENDING", async () => {
    const now = sendHourUtc();
    await seedUser({ id: "u1", now, streakDays: 12 });
    process.env.PUSH_NOTIFICATIONS_ENABLED = "false";

    try {
      const result = await runNotificationJob({ db, now });

      expect(result.dispatch.suppressed).toBe(true);
      expect(result.dispatch.sent).toBe(0);
      expect(global.fetch).not.toHaveBeenCalled();

      const pending = await db.notification.count({
        where: { status: NotificationStatus.PENDING },
      });
      expect(pending).toBe(0);
    } finally {
      delete process.env.PUSH_NOTIFICATIONS_ENABLED;
    }
  });
});
