import { NotificationType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  byPriority,
  categoryOf,
  DAILY_SEND_HOUR,
  decideSend,
  DEFAULT_QUIET_END_HOUR,
  DEFAULT_QUIET_START_HOUR,
  dueThisHourWhere,
  EVENING_SEND_HOUR,
  isQuietHour,
  localHour,
  MAX_PUSHES_PER_DAY,
  offsetsAtLocalHour,
  PENDING_TTL_MS,
  pushDeliveryEnabled,
  toPushPolicy,
  VALID_OFFSETS,
} from "@/server/services/notification-policy";

/**
 * The rules that decide whether a phone lights up. These are pure on purpose —
 * a quiet-hours bug wakes people at 4am and there is no undo — so they are
 * tested as arithmetic rather than through a database.
 */

const NOON = new Date("2026-07-30T12:00:00Z");

describe("the kill switch", () => {
  it("is on when unset, so a fresh environment is never silently mute", () => {
    expect(pushDeliveryEnabled({})).toBe(true);
    expect(pushDeliveryEnabled({ PUSH_NOTIFICATIONS_ENABLED: "" })).toBe(true);
  });

  it("recognises the off-values people actually type", () => {
    for (const value of ["false", "FALSE", "0", "off", "no", " false "]) {
      expect(pushDeliveryEnabled({ PUSH_NOTIFICATIONS_ENABLED: value })).toBe(false);
    }
  });

  it("fails loud on a typo — anything unrecognised leaves pushes flowing", () => {
    for (const value of ["flase", "disabled", "nope", "1", "true"]) {
      expect(pushDeliveryEnabled({ PUSH_NOTIFICATIONS_ENABLED: value })).toBe(true);
    }
  });
});

describe("quiet hours", () => {
  it("wraps midnight, which is the ordinary case", () => {
    // 21:00 → 09:00.
    expect(isQuietHour(22, 21, 9)).toBe(true);
    expect(isQuietHour(3, 21, 9)).toBe(true);
    expect(isQuietHour(8, 21, 9)).toBe(true);
    expect(isQuietHour(9, 21, 9)).toBe(false);
    expect(isQuietHour(12, 21, 9)).toBe(false);
    expect(isQuietHour(20, 21, 9)).toBe(false);
  });

  it("handles a window that does not wrap", () => {
    expect(isQuietHour(10, 9, 17)).toBe(true);
    expect(isQuietHour(17, 9, 17)).toBe(false);
    expect(isQuietHour(2, 9, 17)).toBe(false);
  });

  it("reads start === end as off, never as all day", () => {
    // The other reading would silence a user permanently with no visible cause,
    // and "I set them to the same hour" is a thing people do to mean "none".
    for (let hour = 0; hour < 24; hour += 1) {
      expect(isQuietHour(hour, 0, 0)).toBe(false);
      expect(isQuietHour(hour, 13, 13)).toBe(false);
    }
  });

  it("falls back to the default window rather than trusting a corrupt hour", () => {
    expect(isQuietHour(3, 99, -4)).toBe(true);
    expect(isQuietHour(12, 99, -4)).toBe(false);
  });
});

describe("local hour", () => {
  it("shifts by the offset, with JS's sign convention", () => {
    expect(localHour(NOON, 0)).toBe(12);
    expect(localHour(NOON, -240)).toBe(8);
    expect(localHour(NOON, 600)).toBe(22);
  });

  it("wraps across midnight in both directions", () => {
    expect(localHour(new Date("2026-07-30T23:30:00Z"), 60)).toBe(0);
    expect(localHour(new Date("2026-07-30T00:30:00Z"), -60)).toBe(23);
  });

  it("treats a missing or absurd offset as UTC", () => {
    expect(localHour(NOON, Number.NaN)).toBe(12);
    expect(localHour(NOON, 99_999)).toBe(localHour(NOON, 840));
  });
});

describe("who is due this hour", () => {
  it("covers every user exactly once across 24 consecutive runs", () => {
    // The property the hourly schedule rests on: over a day, each offset is
    // selected on exactly one tick. Miss this and users are either swept twice
    // or never.
    const seen = new Map<number, number>(VALID_OFFSETS.map((o) => [o, 0]));

    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(Date.UTC(2026, 6, 30, hour, 0, 0));
      for (const offset of offsetsAtLocalHour(at, DAILY_SEND_HOUR)) {
        seen.set(offset, (seen.get(offset) ?? 0) + 1);
      }
    }

    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it("selects a real slice of the world on any given tick, never none", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const at = new Date(Date.UTC(2026, 6, 30, hour, 0, 0));
      expect(offsetsAtLocalHour(at, DAILY_SEND_HOUR).length).toBeGreaterThan(0);
    }
  });

  it("picks offsets for which it really is the send hour", () => {
    const at = new Date("2026-07-30T12:00:00Z");
    for (const offset of offsetsAtLocalHour(at, DAILY_SEND_HOUR)) {
      expect(localHour(at, offset)).toBe(DAILY_SEND_HOUR);
    }
  });

  it("selects a different slice for the evening hour, and never the morning one", () => {
    // At 16:00Z it is 9am in UTC-7 and 7pm in UTC+3. Whoever is due for the
    // morning sweep must not also be due for the evening one on the same tick.
    const at = new Date("2026-07-30T16:00:00Z");
    const morning = offsetsAtLocalHour(at, DAILY_SEND_HOUR);
    const evening = offsetsAtLocalHour(at, EVENING_SEND_HOUR);
    expect(morning).toContain(-420);
    expect(evening).toContain(180);
    expect(morning.filter((o) => evening.includes(o))).toEqual([]);

    const where = dueThisHourWhere(at, undefined, EVENING_SEND_HOUR) as {
      OR: { preference: { is: { tzOffsetMinutes?: { in: number[] } } } }[];
    };
    expect(where.OR[0].preference.is.tzOffsetMinutes?.in).toEqual(evening);
  });

  it("the evening hour sits outside the default quiet window", () => {
    expect(isQuietHour(EVENING_SEND_HOUR, DEFAULT_QUIET_START_HOUR, DEFAULT_QUIET_END_HOUR)).toBe(false);
  });
});

describe("the evening reminder's shelf life", () => {
  it("drops a streak reminder that has slipped past its evening, but keeps an observation that old", () => {
    // Both created at 7pm; it is now 2am. The contradiction is as true as
    // ever. "nothing captured today yet" is about yesterday now.
    const createdAt = new Date("2026-07-30T19:00:00Z");
    const now = new Date("2026-07-31T02:00:00Z");
    const policy = toPushPolicy({ quietHoursStartHour: 3, quietHoursEndHour: 3 });
    expect(decideSend({
      type: NotificationType.STREAK_AT_RISK, createdAt, policy, sentInWindow: 0, now,
    })).toBe("drop");
    expect(decideSend({
      type: NotificationType.CONTRADICTION_FOUND, createdAt, policy, sentInWindow: 0, now,
    })).toBe("send");
  });
});

describe("categories", () => {
  it("maps every notification type, including the ones added later", () => {
    // The exhaustive record is what stops STREAK_HELD inheriting somebody
    // else's opt-out by default.
    for (const type of Object.values(NotificationType)) {
      expect(["social", "resurface", "streak"]).toContain(categoryOf(type));
    }
    expect(categoryOf(NotificationType.STREAK_HELD)).toBe("streak");
    expect(categoryOf(NotificationType.CONTRADICTION_FOUND)).toBe("resurface");
    expect(categoryOf(NotificationType.NEW_FOLLOW)).toBe("social");
  });

  it("defaults a user with no preferences row to hearing everything", () => {
    const policy = toPushPolicy(null);
    expect(policy.pushSocial && policy.pushResurface && policy.pushStreak).toBe(true);
  });

  it("treats null columns on an old row as opted in, not out", () => {
    const policy = toPushPolicy({ tzOffsetMinutes: null, pushStreak: null });
    expect(policy.pushStreak).toBe(true);
    expect(policy.tzOffsetMinutes).toBe(0);
  });
});

describe("arbitration order", () => {
  it("puts the perishable push first", () => {
    const queue = [
      NotificationType.NEW_LIKE,
      NotificationType.CONTRADICTION_FOUND,
      NotificationType.STREAK_HELD,
    ].sort(byPriority);

    expect(queue).toEqual([
      NotificationType.STREAK_HELD,
      NotificationType.CONTRADICTION_FOUND,
      NotificationType.NEW_LIKE,
    ]);
  });
});

describe("decideSend", () => {
  const policy = toPushPolicy(null);
  const base = { type: NotificationType.CONTRADICTION_FOUND, createdAt: NOON, policy, now: NOON };

  it("sends when every gate is clear", () => {
    expect(decideSend({ ...base, sentInWindow: 0 })).toBe("send");
  });

  it("holds in quiet hours — later, not never", () => {
    const at = new Date("2026-07-30T03:00:00Z");
    expect(decideSend({ ...base, createdAt: at, now: at, sentInWindow: 0 })).toBe("hold");
  });

  it("holds at the ceiling", () => {
    expect(decideSend({ ...base, sentInWindow: MAX_PUSHES_PER_DAY })).toBe("hold");
  });

  it("drops an opted-out category — a standing answer, not a timing problem", () => {
    expect(decideSend({
      ...base,
      policy: toPushPolicy({ pushResurface: false }),
      sentInWindow: 0,
    })).toBe("drop");
  });

  it("drops a notification held past its usefulness rather than queueing it forever", () => {
    const stale = new Date(NOON.getTime() - PENDING_TTL_MS - 1000);
    expect(decideSend({ ...base, createdAt: stale, sentInWindow: 0 })).toBe("drop");
  });

  it("checks staleness before quiet hours, so a stuck row cannot hold forever", () => {
    const at = new Date("2026-07-30T03:00:00Z");
    const stale = new Date(at.getTime() - PENDING_TTL_MS - 1000);
    expect(decideSend({ ...base, createdAt: stale, now: at, sentInWindow: 0 })).toBe("drop");
  });
});
