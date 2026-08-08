import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  requireRequestUserId: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireRequestUserId: mocks.requireRequestUserId }));
vi.mock("@/server/services/preferences", () => ({
  getPreferences: mocks.getPreferences,
  updatePreferences: mocks.updatePreferences,
}));

import { GET, PATCH } from "@/app/api/me/preferences/route";

function patchRequest(body: unknown): Request {
  return new Request("http://test/api/me/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRequestUserId.mockResolvedValue("user_1");
  mocks.updatePreferences.mockResolvedValue({ id: "pref_1" });
  mocks.getPreferences.mockResolvedValue({ id: "pref_1" });
});

describe("PATCH /api/me/preferences", () => {
  it("rejects an unauthenticated request with 401", async () => {
    mocks.requireRequestUserId.mockRejectedValue(
      new AppError("UNAUTHORIZED", "Authentication is required", 401),
    );

    const res = await PATCH(patchRequest({ pushSocial: false }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("UNAUTHORIZED");
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range quiet hour without calling the service", async () => {
    const res = await PATCH(patchRequest({ quietHoursStartHour: 24 }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it("rejects an empty patch", async () => {
    const res = await PATCH(patchRequest({}));

    expect(res.status).toBe(422);
    expect(mocks.updatePreferences).not.toHaveBeenCalled();
  });

  it("passes a partial update through with only the named fields", async () => {
    const res = await PATCH(patchRequest({ pushResurface: false, quietHoursStartHour: 22 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(mocks.updatePreferences).toHaveBeenCalledWith({
      userId: "user_1",
      insightStyle: undefined,
      preferences: undefined,
      quietHoursStartHour: 22,
      quietHoursEndHour: undefined,
      pushSocial: undefined,
      pushResurface: false,
      pushStreak: undefined,
    });
  });
});

describe("GET /api/me/preferences", () => {
  it("returns the caller's preferences", async () => {
    const res = await GET(new Request("http://test/api/me/preferences"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual({ id: "pref_1" });
    expect(mocks.getPreferences).toHaveBeenCalledWith({ userId: "user_1" });
  });
});
