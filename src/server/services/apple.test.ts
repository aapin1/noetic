import { SignJWT, generateKeyPair, type JWTVerifyGetKey } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api";
import type { RootDbClient } from "@/server/db";

vi.mock("@/lib/auth", () => ({
  createApiToken: vi.fn(async (userId: string) => `api-token-for-${userId}`),
}));

// Profile creation is accounts.ts's unit; here it only matters that new Apple
// accounts get one and returning accounts don't.
vi.mock("@/server/services/accounts", () => ({
  createOnboardingProfile: vi.fn(async ({ userId }: { userId: string }) => ({
    handle: `n_for_${userId}`,
  })),
}));

import { createOnboardingProfile } from "@/server/services/accounts";
import {
  APPLE_AUDIENCE,
  signInWithApple,
  verifyAppleIdentityToken,
} from "./apple";

// ── token verification ──────────────────────────────────────────────────────

let privateKey: CryptoKey;
let getKey: JWTVerifyGetKey;
/** A second key pair standing in for "not Apple": valid JWT, wrong signer. */
let strangerKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey as CryptoKey;
  getKey = (async () => pair.publicKey) as unknown as JWTVerifyGetKey;
  const stranger = await generateKeyPair("RS256");
  strangerKey = stranger.privateKey as CryptoKey;
});

function appleToken(
  overrides: {
    issuer?: string;
    audience?: string;
    sub?: string;
    email?: string;
    expiresAt?: Date;
    key?: CryptoKey;
  } = {},
) {
  const jwt = new SignJWT(overrides.email !== undefined ? { email: overrides.email } : {})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(overrides.issuer ?? "https://appleid.apple.com")
    .setAudience(overrides.audience ?? APPLE_AUDIENCE)
    .setSubject(overrides.sub ?? "apple-sub-1")
    .setIssuedAt();

  if (overrides.expiresAt) {
    jwt.setExpirationTime(overrides.expiresAt);
  } else {
    jwt.setExpirationTime("10m");
  }

  return jwt.sign(overrides.key ?? privateKey);
}

async function expectRejected(token: string) {
  await expect(verifyAppleIdentityToken(token, { getKey })).rejects.toMatchObject({
    code: "INVALID_APPLE_TOKEN",
  });
}

describe("verifyAppleIdentityToken", () => {
  it("accepts a valid token and returns sub and lowercased email", async () => {
    const token = await appleToken({ email: "Person@PrivateRelay.AppleID.com" });
    const identity = await verifyAppleIdentityToken(token, { getKey });
    expect(identity).toEqual({
      sub: "apple-sub-1",
      email: "person@privaterelay.appleid.com",
    });
  });

  it("returns a null email when the token carries none", async () => {
    const token = await appleToken();
    const identity = await verifyAppleIdentityToken(token, { getKey });
    expect(identity.email).toBeNull();
  });

  it("rejects a token signed by the wrong key", async () => {
    await expectRejected(await appleToken({ key: strangerKey }));
  });

  it("rejects a token minted for a different app (wrong audience)", async () => {
    await expectRejected(await appleToken({ audience: "com.other.app" }));
  });

  it("rejects a token from the wrong issuer", async () => {
    await expectRejected(await appleToken({ issuer: "https://evil.example.com" }));
  });

  it("rejects an expired token", async () => {
    await expectRejected(await appleToken({ expiresAt: new Date(Date.now() - 60_000) }));
  });

  it("rejects garbage that is not a JWT at all", async () => {
    await expectRejected("not-a-jwt");
  });
});

// ── create-vs-link account logic ────────────────────────────────────────────

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
  appleUserId: string | null;
  emailVerified: Date | null;
  profile: { handle: string } | null;
};

/** In-memory stand-in for the user table, in the style of moderation.test.ts. */
function fakeDb(seed: Partial<UserRow>[] = []) {
  let nextId = 1;
  const users: UserRow[] = seed.map((row) => ({
    id: row.id ?? `seed-${nextId++}`,
    email: row.email ?? "seed@example.com",
    name: row.name ?? null,
    passwordHash: row.passwordHash ?? null,
    appleUserId: row.appleUserId ?? null,
    emailVerified: row.emailVerified ?? null,
    profile: row.profile ?? null,
  }));

  const db = {
    user: {
      findUnique: async ({ where }: { where: { appleUserId?: string; email?: string } }) => {
        const found = users.find((u) =>
          where.appleUserId !== undefined
            ? u.appleUserId === where.appleUserId
            : u.email === where.email,
        );
        return found ? { ...found } : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<UserRow>;
      }) => {
        const row = users.find((u) => u.id === where.id);
        if (!row) throw new Error("update miss");
        Object.assign(row, data);
        return { ...row };
      },
      create: async ({ data }: { data: Partial<UserRow> }) => {
        const row: UserRow = {
          id: `user-${nextId++}`,
          email: data.email!,
          name: data.name ?? null,
          passwordHash: null,
          appleUserId: data.appleUserId ?? null,
          emailVerified: data.emailVerified ?? null,
          profile: null,
        };
        users.push(row);
        return { ...row };
      },
    },
  };

  return { db: db as unknown as RootDbClient, users };
}

describe("signInWithApple", () => {
  beforeEach(() => {
    vi.mocked(createOnboardingProfile).mockClear();
  });

  it("signs a returning Apple user straight in", async () => {
    const { db, users } = fakeDb([
      { id: "u1", email: "a@b.c", appleUserId: "apple-sub-1", profile: { handle: "handle_a" } },
    ]);

    const result = await signInWithApple({
      identity: { sub: "apple-sub-1", email: "a@b.c" },
      db,
    });

    expect(result.isNewUser).toBe(false);
    expect(result.userId).toBe("u1");
    expect(result.token).toBe("api-token-for-u1");
    expect(result.user.handle).toBe("handle_a");
    expect(users).toHaveLength(1);
    expect(createOnboardingProfile).not.toHaveBeenCalled();
  });

  it("links to an existing email/password account instead of duplicating it", async () => {
    const { db, users } = fakeDb([
      { id: "u1", email: "a@b.c", passwordHash: "hash", profile: { handle: "handle_a" } },
    ]);

    const result = await signInWithApple({
      identity: { sub: "apple-sub-9", email: "a@b.c" },
      db,
    });

    expect(result.isNewUser).toBe(false);
    expect(result.userId).toBe("u1");
    expect(users).toHaveLength(1);
    expect(users[0]!.appleUserId).toBe("apple-sub-9");
    // Linking must never touch the password — the original sign-in keeps working.
    expect(users[0]!.passwordHash).toBe("hash");
  });

  it("creates a new passwordless account when nothing matches", async () => {
    const { db, users } = fakeDb();

    const result = await signInWithApple({
      identity: { sub: "apple-sub-2", email: "new@privaterelay.appleid.com" },
      fullName: "Ada Lovelace",
      db,
    });

    expect(result.isNewUser).toBe(true);
    expect(users).toHaveLength(1);
    expect(users[0]!.appleUserId).toBe("apple-sub-2");
    expect(users[0]!.email).toBe("new@privaterelay.appleid.com");
    expect(users[0]!.name).toBe("Ada Lovelace");
    expect(users[0]!.passwordHash).toBeNull();
    // A new account walks away with a standing profile — no onboarding step.
    expect(createOnboardingProfile).toHaveBeenCalledWith(
      expect.objectContaining({ userId: users[0]!.id, topics: [] }),
    );
    expect(result.user.handle).toBe(`n_for_${users[0]!.id}`);
  });

  it("creates without a name when Apple did not send one (non-first authorization)", async () => {
    const { db, users } = fakeDb();

    const result = await signInWithApple({
      identity: { sub: "apple-sub-3", email: "x@y.z" },
      db,
    });

    expect(result.isNewUser).toBe(true);
    expect(users[0]!.name).toBeNull();
  });

  it("refuses to create an account when the token has no email", async () => {
    const { db, users } = fakeDb();

    await expect(
      signInWithApple({ identity: { sub: "apple-sub-4", email: null }, db }),
    ).rejects.toMatchObject({ code: "APPLE_EMAIL_MISSING" });
    expect(users).toHaveLength(0);
  });

  it("still signs in a returning user whose token omits the email", async () => {
    const { db } = fakeDb([{ id: "u1", email: "a@b.c", appleUserId: "apple-sub-1" }]);

    const result = await signInWithApple({
      identity: { sub: "apple-sub-1", email: null },
      db,
    });

    expect(result.userId).toBe("u1");
  });
});
