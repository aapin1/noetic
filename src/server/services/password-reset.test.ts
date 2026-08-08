import { hashSync } from "bcryptjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RootDbClient } from "@/server/db";
import type { EmailMessage } from "@/server/services/email";

// Cost 4 keeps the suite fast; compare() reads the cost from the hash itself,
// so the service code under test is unchanged.
vi.mock("@/lib/auth", () => ({
  createPasswordHash: vi.fn(async (value: string) => hashSync(value, 4)),
}));

import { confirmPasswordReset, requestPasswordReset } from "./password-reset";

type UserRow = { id: string; email: string; passwordHash: string | null };
type CodeRow = {
  id: string;
  userId: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  createdAt: Date;
};

function fakeDb(seedUsers: UserRow[] = []) {
  const users = seedUsers.map((u) => ({ ...u }));
  let codes: CodeRow[] = [];
  let nextId = 1;

  const db = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.find((u) => u.id === where.id);
        if (!row) throw new Error("update miss");
        Object.assign(row, data);
        return { ...row };
      },
    },
    passwordResetCode: {
      deleteMany: async ({ where }: { where: { userId: string } }) => {
        const before = codes.length;
        codes = codes.filter((c) => c.userId !== where.userId);
        return { count: before - codes.length };
      },
      create: async ({ data }: { data: Omit<CodeRow, "id" | "attempts" | "createdAt"> }) => {
        const row: CodeRow = {
          id: `code-${nextId++}`,
          attempts: 0,
          createdAt: new Date(),
          ...data,
        };
        codes.push(row);
        return { ...row };
      },
      findFirst: async ({ where }: { where: { userId: string } }) => {
        const matching = codes
          .filter((c) => c.userId === where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matching[0] ? { ...matching[0] } : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { attempts: { increment: number } };
      }) => {
        const row = codes.find((c) => c.id === where.id);
        if (!row) throw new Error("update miss");
        row.attempts += data.attempts.increment;
        return { ...row };
      },
    },
  };

  return { db: db as unknown as RootDbClient, users, codes: () => codes };
}

/** Captures outgoing mail and hands back the 6-digit code it contained. */
function mailbox() {
  const sent: EmailMessage[] = [];
  const send = async (message: EmailMessage) => {
    sent.push(message);
    return true;
  };
  const lastCode = () => {
    const match = sent[sent.length - 1]?.text.match(/\b(\d{6})\b/);
    if (!match) throw new Error("no code in last email");
    return match[1]!;
  };
  return { send, sent, lastCode };
}

const USER: UserRow = { id: "u1", email: "a@b.c", passwordHash: "old-hash" };

afterEach(() => {
  vi.useRealTimers();
});

describe("requestPasswordReset", () => {
  it("stores only a hash, emails the code, and expires it in 15 minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const { db, codes } = fakeDb([USER]);
    const { send, sent, lastCode } = mailbox();

    const result = await requestPasswordReset({ email: "A@b.c", db, send });

    expect(result).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("a@b.c");
    expect(codes()).toHaveLength(1);
    expect(codes()[0]!.codeHash).not.toContain(lastCode());
    expect(codes()[0]!.expiresAt).toEqual(new Date("2026-08-08T12:15:00Z"));
  });

  it("answers identically for an address with no account, and sends nothing", async () => {
    const { db, codes } = fakeDb([USER]);
    const { send, sent } = mailbox();

    const result = await requestPasswordReset({ email: "nobody@b.c", db, send });

    expect(result).toEqual({ sent: true });
    expect(sent).toHaveLength(0);
    expect(codes()).toHaveLength(0);
  });

  it("replaces an outstanding code — only the newest one works", async () => {
    const { db, codes } = fakeDb([USER]);
    const first = mailbox();
    const second = mailbox();

    await requestPasswordReset({ email: "a@b.c", db, send: first.send });
    await requestPasswordReset({ email: "a@b.c", db, send: second.send });

    expect(codes()).toHaveLength(1);
    await expect(
      confirmPasswordReset({ email: "a@b.c", code: first.lastCode(), newPassword: "brand new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    // The stale-code attempt above charged the budget but must not kill the
    // real code.
    await expect(
      confirmPasswordReset({ email: "a@b.c", code: second.lastCode(), newPassword: "brand new pw", db }),
    ).resolves.toEqual({ reset: true });
  });
});

describe("confirmPasswordReset", () => {
  async function issue(db: RootDbClient) {
    const { send, lastCode } = mailbox();
    await requestPasswordReset({ email: "a@b.c", db, send });
    return lastCode();
  }

  it("updates the password and invalidates every outstanding code", async () => {
    const { db, users, codes } = fakeDb([USER]);
    const code = await issue(db);

    const result = await confirmPasswordReset({
      email: "a@b.c",
      code,
      newPassword: "brand new pw",
      db,
    });

    expect(result).toEqual({ reset: true });
    expect(users[0]!.passwordHash).not.toBe("old-hash");
    expect(codes()).toHaveLength(0);
  });

  it("is single-use: the same code fails the second time", async () => {
    const { db } = fakeDb([USER]);
    const code = await issue(db);

    await confirmPasswordReset({ email: "a@b.c", code, newPassword: "brand new pw", db });
    await expect(
      confirmPasswordReset({ email: "a@b.c", code, newPassword: "another new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
  });

  it("rejects an expired code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const { db } = fakeDb([USER]);
    const code = await issue(db);

    vi.setSystemTime(new Date("2026-08-08T12:15:01Z"));

    await expect(
      confirmPasswordReset({ email: "a@b.c", code, newPassword: "brand new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
  });

  it("rejects a wrong code without leaking which part was wrong", async () => {
    const { db, users } = fakeDb([USER]);
    const code = await issue(db);
    const wrong = code === "000000" ? "000001" : "000000";

    await expect(
      confirmPasswordReset({ email: "a@b.c", code: wrong, newPassword: "brand new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    expect(users[0]!.passwordHash).toBe("old-hash");
  });

  it("kills the code after 5 attempts, even if the 6th guess is right", async () => {
    const { db, codes } = fakeDb([USER]);
    const code = await issue(db);
    const wrong = code === "000000" ? "000001" : "000000";

    for (let i = 0; i < 5; i++) {
      await expect(
        confirmPasswordReset({ email: "a@b.c", code: wrong, newPassword: "brand new pw", db }),
      ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    }

    await expect(
      confirmPasswordReset({ email: "a@b.c", code, newPassword: "brand new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
    expect(codes()[0]!.attempts).toBe(6);
  });

  it("fails with the same error for an email that has no account", async () => {
    const { db } = fakeDb([USER]);

    await expect(
      confirmPasswordReset({ email: "nobody@b.c", code: "123456", newPassword: "brand new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
  });

  it("fails when no code was ever requested", async () => {
    const { db } = fakeDb([USER]);

    await expect(
      confirmPasswordReset({ email: "a@b.c", code: "123456", newPassword: "brand new pw", db }),
    ).rejects.toMatchObject({ code: "INVALID_RESET_CODE" });
  });
});
