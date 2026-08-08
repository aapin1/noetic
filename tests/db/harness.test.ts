/**
 * Proves the real-database harness itself works: a user round-trips through
 * Postgres, a real Bearer token authenticates against a real route handler,
 * and truncation between tests actually isolates them.
 *
 * If this file fails, nothing else in tests/db/ is trustworthy.
 */
import { describe, expect, it } from "vitest";
import { GET as getPreferences } from "@/app/api/me/preferences/route";
import { authedRequest, createTestUser, prisma, readJson } from "../support/db";

describe("db harness", () => {
  it("writes a user to the real database", async () => {
    const user = await createTestUser({ handle: "harness_one" });

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true, preference: true },
    });

    expect(row?.email).toBe(user.email);
    expect(row?.profile?.handle).toBe("harness_one");
    expect(row?.preference).not.toBeNull();
  });

  it("starts each test from an empty database", async () => {
    // The user created above must be gone — this is the isolation guarantee
    // every other test in this directory leans on.
    expect(await prisma.user.count()).toBe(0);
  });

  it("authenticates a route handler with a real signed token", async () => {
    const user = await createTestUser();

    const { status, data } = await readJson<{ userId: string; insightStyle: string }>(
      await getPreferences(authedRequest(user, "/api/me/preferences")),
    );

    expect(status).toBe(200);
    expect(data.userId).toBe(user.id);
    expect(data.insightStyle).toBe("DIRECT");
  });

  it("rejects an unauthenticated request", async () => {
    const request = new Request("http://localhost:3000/api/me/preferences");
    const { status, error } = await readJson(await getPreferences(request));

    expect(status).toBe(401);
    expect(error?.code).toBe("UNAUTHORIZED");
  });
});
