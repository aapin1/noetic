import { NotificationType } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { dispatchPendingNotifications } from "@/server/services/notifications";

/**
 * The push pipe used to be a lie: it marked every row SENT and transmitted
 * nothing. These tests pin the properties that make it real — that SENT means
 * Expo accepted it, that a failure is visible rather than silent, that a
 * transient outage is retried rather than swallowed, and that none of it can
 * throw into a caller.
 */

/** A fixed "now", so quiet-hours tests read as times rather than arithmetic. */
const NOON_UTC = new Date("2026-07-30T12:00:00Z");

type Row = {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "SENT" | "FAILED";
  sentAt: Date | null;
  createdAt: Date;
  tokens: string[];
};

/** A preferences row, as the policy loader reads it. */
type Prefs = Partial<{
  tzOffsetMinutes: number | null;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  pushSocial: boolean;
  pushResurface: boolean;
  pushStreak: boolean;
}>;

function fakeDb(rows: Row[], prefsByUser: Record<string, Prefs> = {}) {
  const deactivated: string[] = [];

  const db = {
    notification: {
      findMany: async () =>
        rows
          .filter((r) => r.status === "PENDING")
          .map((r) => ({
            id: r.id,
            recipientId: r.recipientId,
            type: r.type,
            title: r.title,
            body: r.body,
            deepLink: r.deepLink,
            payload: r.payload,
            createdAt: r.createdAt,
            recipient: {
              deviceTokens: r.tokens.map((token) => ({
                token,
                provider: "EXPO",
                platform: "IOS",
              })),
            },
          })),
      groupBy: async (args: { where: { sentAt: { gte: Date } } }) => {
        const counts = new Map<string, number>();
        for (const r of rows) {
          if (r.status !== "SENT" || !r.sentAt) continue;
          if (r.sentAt < args.where.sentAt.gte) continue;
          counts.set(r.recipientId, (counts.get(r.recipientId) ?? 0) + 1);
        }
        return [...counts].map(([recipientId, n]) => ({
          recipientId,
          _count: { _all: n },
        }));
      },
      updateMany: async (args: {
        where: { id?: { in: string[] } };
        data: { status: "SENT" | "FAILED"; sentAt?: Date };
      }) => {
        let count = 0;
        for (const row of rows) {
          // No `id` filter means the kill-switch path, which scopes by status
          // alone and sweeps everything pending.
          if (args.where.id && !args.where.id.in.includes(row.id)) continue;
          if (row.status !== "PENDING") continue;
          row.status = args.data.status;
          if (args.data.sentAt) row.sentAt = args.data.sentAt;
          count += 1;
        }
        return { count };
      },
    },
    userPreference: {
      findMany: async (args: { where: { userId: { in: string[] } } }) =>
        args.where.userId.in
          .filter((userId) => prefsByUser[userId])
          .map((userId) => ({ userId, ...prefsByUser[userId] })),
    },
    deviceToken: {
      updateMany: async (args: { where: { token: { in: string[] } } }) => {
        deactivated.push(...args.where.token.in);
        return { count: args.where.token.in.length };
      },
    },
  } as unknown as DbClient;

  return { db, deactivated };
}

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "n1",
    recipientId: "u1",
    type: NotificationType.CONTRADICTION_FOUND,
    title: "two things you saved about attention disagree",
    body: "see where they split.",
    deepLink: "/(tabs)/mind",
    payload: {},
    status: "PENDING",
    sentAt: null,
    createdAt: NOON_UTC,
    tokens: ["ExponentPushToken[aaa]"],
    ...overrides,
  };
}

/** Reply as Expo's /push/send does, with one ticket per message sent. */
function mockExpo(ticketsFor: (count: number) => unknown[], ok = true) {
  return vi.fn(async (_url: string, init?: { body?: string }) => {
    const sent = JSON.parse(String(init?.body ?? "[]")) as unknown[];
    return {
      ok,
      json: async () => ({ data: ticketsFor(sent.length) }),
    };
  });
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
beforeEach(() => {
  vi.restoreAllMocks();
});

describe("dispatchPendingNotifications", () => {
  it("marks SENT only after Expo accepts the message", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok", id: "t1" }))) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(rows[0].status).toBe("SENT");
  });

  it("sends the deep link in the payload the app reads on tap", async () => {
    const fetchMock = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" })));
    global.fetch = fetchMock as never;
    const { db } = fakeDb([row({ deepLink: "/insight/abc" })]);

    await dispatchPendingNotifications({}, db, NOON_UTC);

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body[0].to).toBe("ExponentPushToken[aaa]");
    expect(body[0].data.deepLink).toBe("/insight/abc");
  });

  it("leaves a rejected notification FAILED, not SENT", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = mockExpo((n) =>
      Array.from({ length: n }, () => ({ status: "error", message: "bad token" })),
    ) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe("FAILED");
  });

  it("deactivates DeviceNotRegistered tokens", async () => {
    const rows = [row({ tokens: ["ExponentPushToken[dead]"] })];
    const { db, deactivated } = fakeDb(rows);
    global.fetch = mockExpo((n) =>
      Array.from({ length: n }, () => ({
        status: "error",
        details: { error: "DeviceNotRegistered" },
      })),
    ) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(deactivated).toContain("ExponentPushToken[dead]");
    expect(result.deactivatedTokens).toBe(1);
    expect(rows[0].status).toBe("FAILED");
  });

  it("counts a notification as sent if any one of the user's devices accepts", async () => {
    const rows = [row({ tokens: ["ExponentPushToken[live]", "ExponentPushToken[dead]"] })];
    const { db } = fakeDb(rows);
    global.fetch = mockExpo(() => [
      { status: "ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
    ]) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.sent).toBe(1);
    expect(rows[0].status).toBe("SENT");
  });

  it("keeps rows PENDING when the whole batch fails, so the next drain retries", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.sent).toBe(0);
    expect(rows[0].status).toBe("PENDING");
  });

  it("fails a notification that has no live device rather than claiming it sent", async () => {
    const rows = [row({ tokens: [] })];
    const { db } = fakeDb(rows);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe("FAILED");
  });

  it("batches rather than sending one request per token", async () => {
    // One notification each for 150 different people. They have to be different
    // people: 150 pushes to one user is precisely what the daily ceiling exists
    // to stop, and it would hold 147 of them.
    const rows = Array.from({ length: 150 }, (_, i) =>
      row({ id: `n${i}`, recipientId: `u${i}`, tokens: [`ExponentPushToken[${i}]`] }),
    );
    const { db } = fakeDb(rows);
    const fetchMock = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" })));
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    // 150 messages at 100 per request — two calls, not 150.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(150);
  });

  it("never throws into a caller when the database is unavailable", async () => {
    const brokenDb = {
      notification: {
        findMany: async () => {
          throw new Error("connection refused");
        },
      },
    } as unknown as DbClient;

    await expect(dispatchPendingNotifications({}, brokenDb, NOON_UTC)).resolves.toEqual({
      considered: 0,
      sent: 0,
      failed: 0,
      held: 0,
      deactivatedTokens: 0,
      suppressed: false,
    });
  });

  it("never throws when Expo returns a malformed body", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: "not-an-array" }),
    })) as never;

    await expect(dispatchPendingNotifications({}, db, NOON_UTC)).resolves.toMatchObject({ sent: 0 });
    expect(rows[0].status).toBe("PENDING");
  });
});

/* --------------------------------------------------------------- kill switch */

describe("the kill switch", () => {
  afterEach(() => {
    delete process.env.PUSH_NOTIFICATIONS_ENABLED;
  });

  it("is on when unset — an unconfigured environment must not be silent", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.suppressed).toBe(false);
    expect(result.sent).toBe(1);
  });

  it("transmits nothing when off, and leaves nothing PENDING", async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = "false";
    const rows = [row(), row({ id: "n2", recipientId: "u2" })];
    const { db } = fakeDb(rows);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.suppressed).toBe(true);
    expect(result.sent).toBe(0);
    // Terminal, not piled up: the switch exists for the case where the copy is
    // wrong, and in that case the queue is the last thing you want delivered
    // an hour later when it is flipped back.
    expect(rows.every((r) => r.status === "FAILED")).toBe(true);
  });

  it("only a recognised off-value silences it, so a typo fails loud", async () => {
    process.env.PUSH_NOTIFICATIONS_ENABLED = "flase";
    const { db } = fakeDb([row()]);
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    expect((await dispatchPendingNotifications({}, db, NOON_UTC)).sent).toBe(1);
  });
});

/* --------------------------------------------------------------- quiet hours */

describe("quiet hours", () => {
  it("holds rather than drops, so the push arrives in the next eligible hour", async () => {
    // 04:00 UTC, user at UTC+0 — inside the default 21:00–09:00 window.
    const smallHours = new Date("2026-07-30T04:00:00Z");
    const rows = [row({ createdAt: smallHours })];
    const { db } = fakeDb(rows, { u1: {} });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const held = await dispatchPendingNotifications({}, db, smallHours);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(held.held).toBe(1);
    expect(held.failed).toBe(0);
    expect(rows[0].status).toBe("PENDING");

    // Five hours later the window has passed and the same row goes out. This is
    // the property that makes holding safe rather than a leak.
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;
    const later = await dispatchPendingNotifications({}, db, new Date("2026-07-30T09:30:00Z"));

    expect(later.sent).toBe(1);
    expect(rows[0].status).toBe("SENT");
  });

  it("is evaluated in the user's local time, not the server's", async () => {
    // 04:00 UTC is 23:00 in UTC-5 (quiet) and 14:00 in UTC+10 (not).
    const at = new Date("2026-07-30T04:00:00Z");
    const rows = [
      row({ id: "west", recipientId: "west" }),
      row({ id: "east", recipientId: "east" }),
    ];
    const { db } = fakeDb(rows, {
      west: { tzOffsetMinutes: -300 },
      east: { tzOffsetMinutes: 600 },
    });
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    const result = await dispatchPendingNotifications({}, db, at);

    expect(result.sent).toBe(1);
    expect(result.held).toBe(1);
    expect(rows.find((r) => r.id === "east")?.status).toBe("SENT");
    expect(rows.find((r) => r.id === "west")?.status).toBe("PENDING");
  });

  it("treats start === end as quiet hours switched off, not as all day", async () => {
    const smallHours = new Date("2026-07-30T04:00:00Z");
    const { db } = fakeDb([row({ createdAt: smallHours })], {
      u1: { quietHoursStartHour: 0, quietHoursEndHour: 0 },
    });
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    expect((await dispatchPendingNotifications({}, db, smallHours)).sent).toBe(1);
  });

  it("writes off a notification held past its usefulness rather than queueing it forever", async () => {
    // Three days old: quiet hours would still hold it, but "capture today" has
    // stopped being true and nobody wants it now.
    const rows = [row({ createdAt: new Date("2026-07-27T12:00:00Z") })];
    const { db } = fakeDb(rows);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe("FAILED");
  });
});

/* ------------------------------------------------- categories and the ceiling */

describe("category preferences", () => {
  it("drops a category the user switched off", async () => {
    const rows = [row({ type: NotificationType.CONTRADICTION_FOUND })];
    const { db } = fakeDb(rows, { u1: { pushResurface: false } });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(fetchMock).not.toHaveBeenCalled();
    // Dropped, not held: an opt-out is a standing answer, and holding it would
    // queue the row forever.
    expect(result.failed).toBe(1);
    expect(result.held).toBe(0);
    expect(rows[0].status).toBe("FAILED");
  });

  it("covers STREAK_HELD, which is neither social nor resurfacing", async () => {
    const rows = [row({ type: NotificationType.STREAK_HELD })];
    const { db } = fakeDb(rows, { u1: { pushStreak: false } });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("FAILED");
  });

  it("does not let one category's opt-out silence another", async () => {
    const rows = [
      row({ id: "streak", type: NotificationType.STREAK_HELD }),
      row({ id: "social", type: NotificationType.NEW_FOLLOW }),
    ];
    const { db } = fakeDb(rows, { u1: { pushSocial: false } });
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(rows.find((r) => r.id === "streak")?.status).toBe("SENT");
    expect(rows.find((r) => r.id === "social")?.status).toBe("FAILED");
  });
});

describe("the daily ceiling and arbitration", () => {
  it("caps how many pushes one person can receive in a day", async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      row({ id: `n${i}`, type: NotificationType.NEW_LIKE }),
    );
    const { db } = fakeDb(rows);
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.sent).toBe(3);
    // The rest hold rather than fail — they are surplus now, not worthless.
    expect(result.held).toBe(3);
  });

  it("counts what was already sent today, not just this drain", async () => {
    const rows = [
      row({ id: "old", status: "SENT", sentAt: new Date("2026-07-30T08:00:00Z") }),
      row({ id: "old2", status: "SENT", sentAt: new Date("2026-07-30T09:00:00Z") }),
      row({ id: "old3", status: "SENT", sentAt: new Date("2026-07-30T10:00:00Z") }),
      row({ id: "new" }),
    ];
    const { db } = fakeDb(rows);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.held).toBe(1);
    expect(rows.find((r) => r.id === "new")?.status).toBe("PENDING");
  });

  it("gives the last slot to the streak push, not the resurfacing one", async () => {
    // Two pushes, one slot left. The streak one is perishable — it is only true
    // today — so it must win, and it must win by rule rather than by arriving
    // first. The resurfacing row is created earlier here on purpose: ordering by
    // createdAt alone would pick the wrong one.
    const rows = [
      row({ id: "spent", status: "SENT", sentAt: new Date("2026-07-30T08:00:00Z") }),
      row({ id: "spent2", status: "SENT", sentAt: new Date("2026-07-30T09:00:00Z") }),
      row({
        id: "resurface",
        type: NotificationType.CONTRADICTION_FOUND,
        createdAt: new Date("2026-07-30T11:00:00Z"),
      }),
      row({
        id: "streak",
        type: NotificationType.STREAK_HELD,
        createdAt: new Date("2026-07-30T11:30:00Z"),
      }),
    ];
    const { db } = fakeDb(rows);
    global.fetch = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" }))) as never;

    const result = await dispatchPendingNotifications({}, db, NOON_UTC);

    expect(result.sent).toBe(1);
    expect(rows.find((r) => r.id === "streak")?.status).toBe("SENT");
    // And the loser holds rather than failing, so it can go out tomorrow.
    expect(rows.find((r) => r.id === "resurface")?.status).toBe("PENDING");
  });
});
