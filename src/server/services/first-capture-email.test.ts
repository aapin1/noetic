import { beforeAll, describe, expect, it } from "vitest";
import type { DbClient } from "@/server/db";
import type { EmailMessage } from "@/server/services/email";
import {
  firstCaptureEmailFor,
  runFirstCaptureEmailSweep,
  unsubscribeUrl,
  verifyUnsubscribe,
} from "@/server/services/first-capture-email";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unit";
  process.env.DIRECT_URL ??= "postgres://unit";
  process.env.NEXTAUTH_URL ??= "https://mneme.test";
  process.env.NEXTAUTH_SECRET ??= "unit-test-secret-value";
  process.env.MNEME_BASE_URL ??= "https://mneme.test";
});

const DAY = 86_400_000;
const NOW = new Date("2026-10-13T13:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const base = {
  now: NOW,
  name: "Tori Example",
  seenKeys: new Set<string>(),
  openUrl: "https://mneme.test/api/open",
  unsubscribeUrl: "https://mneme.test/u",
};

describe("firstCaptureEmailFor", () => {
  it("says nothing on the signup day", () => {
    expect(firstCaptureEmailFor({ ...base, signupAt: new Date(NOW.getTime() - 20 * 3_600_000) })).toBeNull();
  });

  it("sends the first email a day after signup, greeting by first name, with both links", () => {
    const email = firstCaptureEmailFor({ ...base, signupAt: daysAgo(1) });
    expect(email?.key).toBe("email:first-capture:1");
    expect(email?.text).toMatch(/^Hi Tori,/);
    expect(email?.text).toContain("https://mneme.test/api/open");
    expect(email?.text).toContain("Unsubscribe: https://mneme.test/u");
  });

  it("does not repeat a rung", () => {
    expect(firstCaptureEmailFor({ ...base, signupAt: daysAgo(3), seenKeys: new Set(["email:first-capture:1"]) })).toBeNull();
  });

  it("sends the last email at day five, and only it to an account first seen late", () => {
    const late = firstCaptureEmailFor({ ...base, signupAt: daysAgo(12) });
    expect(late?.key).toBe("email:first-capture:5");
    expect(late?.text).toContain("last reminder");
    expect(firstCaptureEmailFor({ ...base, signupAt: daysAgo(12), seenKeys: new Set(["email:first-capture:5"]) })).toBeNull();
  });

  it("falls back to a plain greeting without a usable name", () => {
    expect(firstCaptureEmailFor({ ...base, name: null, signupAt: daysAgo(1) })?.text).toMatch(/^Hi,/);
  });

  it("uses no em dashes, matching the push copy rule", () => {
    for (const d of [1, 5]) expect(firstCaptureEmailFor({ ...base, signupAt: daysAgo(d) })?.text).not.toContain("—");
  });
});

describe("unsubscribe links", () => {
  it("verifies its own signature and nothing else", () => {
    const url = new URL(unsubscribeUrl("user_1"));
    const t = url.searchParams.get("t");
    expect(url.pathname).toBe("/api/email/unsubscribe");
    expect(verifyUnsubscribe("user_1", t)).toBe(true);
    expect(verifyUnsubscribe("user_2", t)).toBe(false);
    expect(verifyUnsubscribe("user_1", "forged")).toBe(false);
    expect(verifyUnsubscribe(null, t)).toBe(false);
  });
});

describe("runFirstCaptureEmailSweep", () => {
  function fakeDb(existing: { recipientId: string; payload: unknown }[] = []) {
    const rows: { id: string; recipientId: string; payload: unknown }[] = existing.map((r, i) => ({ id: `old${i}`, ...r }));
    let queries = 0;
    const db = {
      notification: {
        findMany: async () => { queries += 1; return rows; },
        create: async (args: { data: { recipientId: string; payload: unknown } }) => {
          const row = { id: `n${rows.length}`, recipientId: args.data.recipientId, payload: args.data.payload };
          rows.push(row);
          return { id: row.id };
        },
        delete: async (args: { where: { id: string } }) => {
          rows.splice(rows.findIndex((r) => r.id === args.where.id), 1);
        },
      },
    } as unknown as DbClient;
    return { db, rows, queries: () => queries };
  }

  const user = (id: string, days: number) => ({ id, email: `${id}@x.test`, name: null, createdAt: daysAgo(days) });

  it("does not touch the database when nobody is eligible", async () => {
    const { db, queries } = fakeDb();
    const result = await runFirstCaptureEmailSweep({ db, now: NOW, users: [], send: async () => true });
    expect(result).toEqual({ considered: 0, sent: 0 });
    expect(queries()).toBe(0);
  });

  it("sends with one-click unsubscribe headers and records the rung", async () => {
    const { db, rows } = fakeDb();
    const sent: EmailMessage[] = [];
    const result = await runFirstCaptureEmailSweep({
      db, now: NOW, users: [user("a", 1)], send: async (m) => { sent.push(m); return true; },
    });
    expect(result.sent).toBe(1);
    expect(sent[0]?.to).toBe("a@x.test");
    expect(sent[0]?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(rows.map((r) => (r.payload as { resurfaceKey: string }).resurfaceKey)).toEqual(["email:first-capture:1"]);
  });

  it("frees the rung when the send fails, so tomorrow retries", async () => {
    const { db, rows } = fakeDb();
    const result = await runFirstCaptureEmailSweep({ db, now: NOW, users: [user("a", 1)], send: async () => false });
    expect(result.sent).toBe(0);
    expect(rows).toHaveLength(0);
  });

  it("skips a rung the user was already sent", async () => {
    const { db } = fakeDb([{ recipientId: "a", payload: { resurfaceKey: "email:first-capture:1" } }]);
    let calls = 0;
    await runFirstCaptureEmailSweep({ db, now: NOW, users: [user("a", 2)], send: async () => { calls += 1; return true; } });
    expect(calls).toBe(0);
  });
});
