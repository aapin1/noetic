import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique } },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXTAUTH_SECRET: "test-secret-value-1234567890" }),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

import { createApiToken, forgetUser, getRequestUserId, resetUserCache } from "@/lib/auth";

function bearerRequest(token: string) {
  return new Request("https://example.com/api/me/profile", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("getRequestUserId", () => {
  beforeEach(() => {
    findUnique.mockReset();
    resetUserCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("authenticates a signed token when the user still exists", async () => {
    findUnique.mockResolvedValue({ id: "user_1" });
    const token = await createApiToken("user_1");

    await expect(getRequestUserId(bearerRequest(token))).resolves.toBe("user_1");
  });

  it("rejects a signed token whose account no longer exists (e.g. wiped DB)", async () => {
    findUnique.mockResolvedValue(null);
    const token = await createApiToken("ghost_user");

    await expect(getRequestUserId(bearerRequest(token))).resolves.toBeNull();
  });

  describe("account-liveness cache", () => {
    it("checks the database once, then serves repeat requests from memory", async () => {
      findUnique.mockResolvedValue({ id: "user_1" });
      const token = await createApiToken("user_1");

      for (let i = 0; i < 5; i++) {
        await expect(getRequestUserId(bearerRequest(token))).resolves.toBe("user_1");
      }

      expect(findUnique).toHaveBeenCalledTimes(1);
    });

    // Caching a miss would lock a freshly registered user out for the whole TTL.
    it("does not cache absence", async () => {
      findUnique.mockResolvedValue(null);
      const token = await createApiToken("later_user");

      await expect(getRequestUserId(bearerRequest(token))).resolves.toBeNull();

      findUnique.mockResolvedValue({ id: "later_user" });
      await expect(getRequestUserId(bearerRequest(token))).resolves.toBe("later_user");
    });

    // This is what keeps the guarantee the uncached version gave: an in-app
    // delete stops the token working immediately, not at the end of the TTL.
    it("stops authenticating as soon as the account is forgotten", async () => {
      findUnique.mockResolvedValue({ id: "user_2" });
      const token = await createApiToken("user_2");
      await expect(getRequestUserId(bearerRequest(token))).resolves.toBe("user_2");

      forgetUser("user_2");
      findUnique.mockResolvedValue(null);

      await expect(getRequestUserId(bearerRequest(token))).resolves.toBeNull();
    });

    it("re-checks the database once the entry expires", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-21T00:00:00Z"));

      findUnique.mockResolvedValue({ id: "user_3" });
      const token = await createApiToken("user_3");

      await getRequestUserId(bearerRequest(token));
      await getRequestUserId(bearerRequest(token));
      expect(findUnique).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61_000);
      await getRequestUserId(bearerRequest(token));
      expect(findUnique).toHaveBeenCalledTimes(2);
    });
  });
});
