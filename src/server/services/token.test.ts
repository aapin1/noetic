import { hashSync } from "bcryptjs";
import { describe, expect, it, vi } from "vitest";
import type { RootDbClient } from "@/server/db";

vi.mock("@/lib/auth", () => ({
  createApiToken: vi.fn(async (userId: string) => `api-token-for-${userId}`),
}));

import { createTokenFromCredentials } from "./token";

// Cost 4 keeps the test fast; the service only ever calls compare().
const PASSWORD = "correct horse battery";
const PASSWORD_HASH = hashSync(PASSWORD, 4);

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  appleUserId: string | null;
  profile: { handle: string } | null;
};

function fakeDb(seed: Partial<UserRow>[] = []) {
  const users: UserRow[] = seed.map((row, i) => ({
    id: row.id ?? `u${i + 1}`,
    email: row.email ?? `user${i + 1}@example.com`,
    name: row.name ?? null,
    passwordHash: row.passwordHash ?? null,
    appleUserId: row.appleUserId ?? null,
    profile: row.profile ?? null,
  }));

  const db = {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) =>
        users.find((u) => u.email === where.email) ?? null,
      findFirst: async ({ where }: { where: { profile: { handle: string } } }) =>
        users.find((u) => u.profile?.handle === where.profile.handle) ?? null,
    },
  };

  return db as unknown as RootDbClient;
}

describe("createTokenFromCredentials", () => {
  it("signs in an email/password account", async () => {
    const db = fakeDb([
      { id: "u1", email: "a@b.c", passwordHash: PASSWORD_HASH, profile: { handle: "h" } },
    ]);

    const result = await createTokenFromCredentials("A@b.c", PASSWORD, db);
    expect(result.userId).toBe("u1");
    expect(result.token).toBe("api-token-for-u1");
  });

  it("rejects an Apple-only account with a use-apple message, not invalid credentials", async () => {
    const db = fakeDb([
      { id: "u1", email: "a@b.c", passwordHash: null, appleUserId: "apple-sub-1" },
    ]);

    await expect(createTokenFromCredentials("a@b.c", PASSWORD, db)).rejects.toMatchObject({
      code: "USE_APPLE_SIGN_IN",
      status: 401,
    });
  });

  it("keeps the generic error for unknown accounts and wrong passwords", async () => {
    const db = fakeDb([{ id: "u1", email: "a@b.c", passwordHash: PASSWORD_HASH }]);

    await expect(createTokenFromCredentials("nobody@b.c", PASSWORD, db)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    await expect(createTokenFromCredentials("a@b.c", "wrong password!", db)).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });
});
