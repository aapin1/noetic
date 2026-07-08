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

import { createApiToken, getRequestUserId } from "@/lib/auth";

function bearerRequest(token: string) {
  return new Request("https://example.com/api/me/profile", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("getRequestUserId", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  afterEach(() => {
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
});
