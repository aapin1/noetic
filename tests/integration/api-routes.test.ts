import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Visibility } from "@prisma/client";

const {
  requireRequestUserId,
  getRequestUserId,
  createLogEntry,
  createOnboardingProfile,
  getOwnerProfile,
  getFeed,
  searchEverything,
} = vi.hoisted(() => ({
  requireRequestUserId: vi.fn(),
  getRequestUserId: vi.fn(),
  createLogEntry: vi.fn(),
  createOnboardingProfile: vi.fn(),
  getOwnerProfile: vi.fn(),
  getFeed: vi.fn(),
  searchEverything: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireRequestUserId,
  getRequestUserId,
}));

vi.mock("@/server/services/logging", () => ({
  createLogEntry,
}));

vi.mock("@/server/services/accounts", () => ({
  createOnboardingProfile,
}));

vi.mock("@/server/services/profile", () => ({
  getOwnerProfile,
}));

vi.mock("@/server/services/feed", () => ({
  getFeed,
}));

vi.mock("@/server/services/search", () => ({
  searchEverything,
}));

import { GET as getFeedRoute } from "@/app/api/feed/route";
import { POST as postLogsRoute } from "@/app/api/logs/route";
import { POST as postOnboardingRoute } from "@/app/api/profile/onboarding/route";
import { GET as getSearchRoute } from "@/app/api/search/route";

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  requireRequestUserId.mockResolvedValue("user_1");
  getRequestUserId.mockResolvedValue("user_1");
});

describe("POST /api/logs", () => {
  it("uses schema defaults and returns the wrapped service response", async () => {
    createLogEntry.mockResolvedValue({ id: "log_1" });

    const response = await postLogsRoute(
      new Request("http://localhost/api/logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentItemId: "content_1" }),
      }),
    );

    expect(createLogEntry).toHaveBeenCalledWith({
      userId: "user_1",
      contentItemId: "content_1",
      rating: undefined,
      annotation: undefined,
      review: undefined,
      topics: [],
      visibility: Visibility.PUBLIC,
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { id: "log_1" },
    });
  });
});

describe("POST /api/profile/onboarding", () => {
  it("creates the profile then returns the composed owner profile", async () => {
    createOnboardingProfile.mockResolvedValue({ id: "profile_1" });
    getOwnerProfile.mockResolvedValue({ profile: { handle: "ada" } });

    const response = await postOnboardingRoute(
      new Request("http://localhost/api/profile/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "ada_lovelace",
          displayName: "Ada Lovelace",
        }),
      }),
    );

    expect(createOnboardingProfile).toHaveBeenCalledWith({
      userId: "user_1",
      handle: "ada_lovelace",
      displayName: "Ada Lovelace",
      bio: undefined,
      publicNotes: undefined,
      avatarUrl: undefined,
      topics: [],
    });
    expect(getOwnerProfile).toHaveBeenCalledWith("user_1");
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { profile: { handle: "ada" } },
    });
  });
});

describe("GET /api/feed", () => {
  it("parses query params and delegates to the feed service", async () => {
    getFeed.mockResolvedValue([{ id: "item_1" }]);

    const response = await getFeedRoute(new Request("http://localhost/api/feed?sort=chronological&limit=5"));

    expect(getFeed).toHaveBeenCalledWith({
      userId: "user_1",
      sort: "chronological",
      limit: 5,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: [{ id: "item_1" }],
    });
  });
});

describe("GET /api/search", () => {
  it("uses search defaults from the schema", async () => {
    searchEverything.mockResolvedValue({ users: [], contentItems: [], topics: [] });

    const response = await getSearchRoute(new Request("http://localhost/api/search?query=noetic"));

    expect(searchEverything).toHaveBeenCalledWith({
      query: "noetic",
      limit: 10,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { users: [], contentItems: [], topics: [] },
    });
  });
});
