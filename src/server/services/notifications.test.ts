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

type Row = {
  id: string;
  recipientId: string;
  title: string;
  body: string;
  deepLink: string;
  payload: Record<string, unknown>;
  status: "PENDING" | "SENT" | "FAILED";
  tokens: string[];
};

function fakeDb(rows: Row[]) {
  const deactivated: string[] = [];

  const db = {
    notification: {
      findMany: async (args?: { select?: Record<string, unknown> }) => {
        const pending = rows.filter((r) => r.status === "PENDING");
        // The dispatcher makes two passes: one projecting payloads (with the
        // recipient + tokens included) and one selecting bare ids.
        if (args?.select) return pending.map((r) => ({ id: r.id }));
        return pending.map((r) => ({
          id: r.id,
          recipientId: r.recipientId,
          title: r.title,
          body: r.body,
          deepLink: r.deepLink,
          payload: r.payload,
          recipient: {
            deviceTokens: r.tokens.map((token) => ({
              token,
              provider: "EXPO",
              platform: "IOS",
            })),
          },
        }));
      },
      updateMany: async (args: {
        where: { id: { in: string[] } };
        data: { status: "SENT" | "FAILED" };
      }) => {
        let count = 0;
        for (const row of rows) {
          if (args.where.id.in.includes(row.id) && row.status === "PENDING") {
            row.status = args.data.status;
            count += 1;
          }
        }
        return { count };
      },
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
    title: "two things you saved about attention disagree",
    body: "see where they split.",
    deepLink: "/(tabs)/mind",
    payload: {},
    status: "PENDING",
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

    const result = await dispatchPendingNotifications({}, db);

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(rows[0].status).toBe("SENT");
  });

  it("sends the deep link in the payload the app reads on tap", async () => {
    const fetchMock = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" })));
    global.fetch = fetchMock as never;
    const { db } = fakeDb([row({ deepLink: "/insight/abc" })]);

    await dispatchPendingNotifications({}, db);

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

    const result = await dispatchPendingNotifications({}, db);

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

    const result = await dispatchPendingNotifications({}, db);

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

    const result = await dispatchPendingNotifications({}, db);

    expect(result.sent).toBe(1);
    expect(rows[0].status).toBe("SENT");
  });

  it("keeps rows PENDING when the whole batch fails, so the next drain retries", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as never;

    const result = await dispatchPendingNotifications({}, db);

    expect(result.sent).toBe(0);
    expect(rows[0].status).toBe("PENDING");
  });

  it("fails a notification that has no live device rather than claiming it sent", async () => {
    const rows = [row({ tokens: [] })];
    const { db } = fakeDb(rows);
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(rows[0].status).toBe("FAILED");
  });

  it("batches rather than sending one request per token", async () => {
    const rows = Array.from({ length: 150 }, (_, i) =>
      row({ id: `n${i}`, tokens: [`ExponentPushToken[${i}]`] }),
    );
    const { db } = fakeDb(rows);
    const fetchMock = mockExpo((n) => Array.from({ length: n }, () => ({ status: "ok" })));
    global.fetch = fetchMock as never;

    const result = await dispatchPendingNotifications({}, db);

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

    await expect(dispatchPendingNotifications({}, brokenDb)).resolves.toEqual({
      sent: 0,
      failed: 0,
      deactivatedTokens: 0,
    });
  });

  it("never throws when Expo returns a malformed body", async () => {
    const rows = [row()];
    const { db } = fakeDb(rows);
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: "not-an-array" }),
    })) as never;

    await expect(dispatchPendingNotifications({}, db)).resolves.toMatchObject({ sent: 0 });
    expect(rows[0].status).toBe("PENDING");
  });
});
