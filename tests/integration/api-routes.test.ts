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
  captureItem,
  listCaptures,
  getCapture,
  deleteCapture,
  getMemoryGraph,
  getMemoryTrends,
  getPreferences,
  updatePreferences,
  addCompanionReply,
  listArchiveFolders,
  getArchiveFolder,
} = vi.hoisted(() => ({
  requireRequestUserId: vi.fn(),
  getRequestUserId: vi.fn(),
  createLogEntry: vi.fn(),
  createOnboardingProfile: vi.fn(),
  getOwnerProfile: vi.fn(),
  getFeed: vi.fn(),
  searchEverything: vi.fn(),
  captureItem: vi.fn(),
  listCaptures: vi.fn(),
  getCapture: vi.fn(),
  deleteCapture: vi.fn(),
  getMemoryGraph: vi.fn(),
  getMemoryTrends: vi.fn(),
  getPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  addCompanionReply: vi.fn(),
  listArchiveFolders: vi.fn(),
  getArchiveFolder: vi.fn(),
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

vi.mock("@/server/services/cognition", () => ({
  captureItem,
  listCaptures,
  getCapture,
  deleteCapture,
}));

vi.mock("@/server/services/memory", () => ({
  getMemoryGraph,
  getMemoryTrends,
}));

vi.mock("@/server/services/archive", () => ({
  listArchiveFolders,
  getArchiveFolder,
}));

vi.mock("@/server/services/preferences", () => ({
  getPreferences,
  updatePreferences,
}));

vi.mock("@/server/services/companion", () => ({
  addCompanionReply,
}));

import { GET as getFeedRoute } from "@/app/api/feed/route";
import { POST as postLogsRoute } from "@/app/api/logs/route";
import { GET as getMemoryGraphRoute } from "@/app/api/memory/graph/route";
import { GET as getMemoryTrendsRoute } from "@/app/api/memory/trends/route";
import { GET as getPreferencesRoute, PATCH as patchPreferencesRoute } from "@/app/api/me/preferences/route";
import { POST as postOnboardingRoute } from "@/app/api/profile/onboarding/route";
import { GET as getSearchRoute } from "@/app/api/search/route";
import { DELETE as deleteCaptureRoute, GET as getCaptureByIdRoute } from "@/app/api/captures/[id]/route";
import { GET as getCapturesRoute, POST as postCapturesRoute } from "@/app/api/captures/route";
import { POST as postCompanionReplyRoute } from "@/app/api/companion/reply/route";
import { GET as getArchiveFoldersRoute } from "@/app/api/archive/route";
import { GET as getArchiveFolderRoute } from "@/app/api/archive/[topicId]/route";

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
  it("creates the profile then returns the owner profile payload", async () => {
    createOnboardingProfile.mockResolvedValue({ id: "profile_1" });
    getOwnerProfile.mockResolvedValue({
      user: {
        id: "user_1",
        profile: {
          handle: "ada_lovelace",
          displayName: "Ada Lovelace",
          bio: null,
          publicNotes: null,
          avatarUrl: null,
          identitySummary: null,
          isOnboarded: true,
        },
      },
    });

    const response = await postOnboardingRoute(
      new Request("http://localhost/api/profile/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: "ada_lovelace",
          displayName: "Ada Lovelace",
          topics: ["philosophy", "science", "design"],
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
      topics: ["philosophy", "science", "design"],
      insightStyle: undefined,
    });
    expect(getOwnerProfile).toHaveBeenCalledWith("user_1");
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        profile: {
          id: "user_1",
          handle: "ada_lovelace",
          displayName: "Ada Lovelace",
          bio: null,
          publicNotes: null,
          avatarUrl: null,
          identitySummary: null,
          isOnboarded: true,
        },
      },
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

    const response = await getSearchRoute(new Request("http://localhost/api/search?query=mneme"));

    expect(searchEverything).toHaveBeenCalledWith({
      query: "mneme",
      limit: 10,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { users: [], contentItems: [], topics: [] },
    });
  });
});

describe("capture routes", () => {
  it("creates a capture with cognition payload", async () => {
    captureItem.mockResolvedValue({ id: "cap_1", insights: [], related: [], edges: [] });

    const response = await postCapturesRoute(
      new Request("http://localhost/api/captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "LINK",
          url: "https://www.youtube.com/watch?v=abc123",
          topicHints: ["philosophy"],
        }),
      }),
    );

    expect(captureItem).toHaveBeenCalledWith({
      userId: "user_1",
      kind: "LINK",
      url: "https://www.youtube.com/watch?v=abc123",
      text: undefined,
      caption: undefined,
      mediaUrl: undefined,
      reaction: undefined,
      topicHints: ["philosophy"],
    });
    expect(response.status).toBe(201);
  });

  it("lists captures with query defaults", async () => {
    listCaptures.mockResolvedValue([{ id: "cap_1" }]);
    const response = await getCapturesRoute(new Request("http://localhost/api/captures?limit=5"));
    expect(listCaptures).toHaveBeenCalledWith({ userId: "user_1", limit: 5 });
    expect(response.status).toBe(200);
  });

  it("gets capture by id", async () => {
    getCapture.mockResolvedValue({ id: "cap_1", insights: [], related: [] });
    const response = await getCaptureByIdRoute(
      new Request("http://localhost/api/captures/cap_1"),
      { params: { id: "cap_1" } },
    );
    expect(getCapture).toHaveBeenCalledWith({ userId: "user_1", capturedItemId: "cap_1" });
    expect(response.status).toBe(200);
  });

  it("deletes a capture by id", async () => {
    deleteCapture.mockResolvedValue(undefined);
    const response = await deleteCaptureRoute(
      new Request("http://localhost/api/captures/cap_1", { method: "DELETE" }),
      { params: { id: "cap_1" } },
    );
    expect(deleteCapture).toHaveBeenCalledWith({ userId: "user_1", capturedItemId: "cap_1" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data).toEqual({ deleted: true });
  });
});

describe("archive routes", () => {
  it("lists archive folders for the current user", async () => {
    listArchiveFolders.mockResolvedValue([
      { topicId: "t1", name: "philosophy", slug: "philosophy", kind: "general", count: 3, latestActivity: "2026-01-01T00:00:00.000Z" },
    ]);

    const response = await getArchiveFoldersRoute(new Request("http://localhost/api/archive"));

    expect(listArchiveFolders).toHaveBeenCalledWith({ userId: "user_1" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.folders).toHaveLength(1);
  });

  it("gets a single archive folder by topic id", async () => {
    getArchiveFolder.mockResolvedValue({
      topicId: "t1",
      name: "philosophy",
      kind: "general",
      subfolders: [],
      entries: [],
    });

    const response = await getArchiveFolderRoute(
      new Request("http://localhost/api/archive/t1"),
      { params: { topicId: "t1" } },
    );

    expect(getArchiveFolder).toHaveBeenCalledWith({ userId: "user_1", topicId: "t1" });
    expect(response.status).toBe(200);
  });
});

describe("memory routes", () => {
  it("returns graph payload", async () => {
    getMemoryGraph.mockResolvedValue({ nodes: [], edges: [], clusters: [] });
    const response = await getMemoryGraphRoute(new Request("http://localhost/api/memory/graph?limit=12"));
    expect(getMemoryGraph).toHaveBeenCalledWith({ userId: "user_1", limit: 12 });
    expect(response.status).toBe(200);
  });

  it("returns trends payload", async () => {
    getMemoryTrends.mockResolvedValue({ window: "month", captureCount: 0, sparkline: [], themes: [], shifts: [], recurring: [], events: [] });
    const response = await getMemoryTrendsRoute(new Request("http://localhost/api/memory/trends?window=month"));
    expect(getMemoryTrends).toHaveBeenCalledWith({ userId: "user_1", window: "month" });
    expect(response.status).toBe(200);
  });
});

describe("preferences routes", () => {
  it("gets preferences", async () => {
    getPreferences.mockResolvedValue({ userId: "user_1", insightStyle: "DIRECT" });
    const response = await getPreferencesRoute(new Request("http://localhost/api/me/preferences"));
    expect(getPreferences).toHaveBeenCalledWith({ userId: "user_1" });
    expect(response.status).toBe(200);
  });

  it("updates preferences", async () => {
    updatePreferences.mockResolvedValue({ userId: "user_1", insightStyle: "ANALYTICAL", preferences: { density: "high" } });
    const response = await patchPreferencesRoute(
      new Request("http://localhost/api/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          insightStyle: "ANALYTICAL",
          preferences: { density: "high" },
        }),
      }),
    );
    expect(updatePreferences).toHaveBeenCalledWith({
      userId: "user_1",
      insightStyle: "ANALYTICAL",
      preferences: { density: "high" },
    });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/companion/reply", () => {
  it("passes contextItemIds through to the service when provided", async () => {
    addCompanionReply.mockResolvedValue({
      userMessage: { id: "msg_1", role: "USER", content: "Find the connection" },
      companionMessage: { id: "msg_2", role: "COMPANION", content: "They both argue X." },
    });

    const response = await postCompanionReplyRoute(
      new Request("http://localhost/api/companion/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Find the connection", contextItemIds: ["item_1", "item_2"] }),
      }),
    );

    expect(addCompanionReply).toHaveBeenCalledWith({
      userId: "user_1",
      content: "Find the connection",
      contextItemIds: ["item_1", "item_2"],
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        userMessage: { id: "msg_1", role: "USER", content: "Find the connection" },
        companionMessage: { id: "msg_2", role: "COMPANION", content: "They both argue X." },
      },
    });
  });

  it("omits contextItemIds when not provided", async () => {
    addCompanionReply.mockResolvedValue({
      userMessage: { id: "msg_3", role: "USER", content: "hello" },
      companionMessage: { id: "msg_4", role: "COMPANION", content: "hi" },
    });

    await postCompanionReplyRoute(
      new Request("http://localhost/api/companion/reply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      }),
    );

    expect(addCompanionReply).toHaveBeenCalledWith({
      userId: "user_1",
      content: "hello",
      contextItemIds: undefined,
    });
  });
});
