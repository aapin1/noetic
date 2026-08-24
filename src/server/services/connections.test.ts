import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";

/**
 * The sync loop, against a fake db and fake providers. What matters here is
 * the bookkeeping the design rests on: the ledger makes a sync idempotent, a
 * cap leaves the rest for next time without losing it, a provider failure
 * becomes a sentence on the row rather than an exception, and the hourly job
 * only touches connections that are due.
 */

const captureItem = vi.fn();
const createManualContentItem = vi.fn();
const resolveWork = vi.fn(async (..._args: unknown[]) => null as unknown);
const providerFetch = vi.fn();
const providerLink = vi.fn();

vi.mock("@/server/services/cognition", () => ({ captureItem: (...a: unknown[]) => captureItem(...a) }));
vi.mock("@/server/imports/resolve", () => ({ resolveWork: (...a: unknown[]) => resolveWork(...a) }));
vi.mock("@/server/services/content", () => ({ createManualContentItem: (...a: unknown[]) => createManualContentItem(...a) }));
vi.mock("@/server/services/admission", () => ({ capturePipeline: { run: (fn: () => Promise<unknown>) => fn() } }));
vi.mock("@/server/connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/connections")>();
  const fake = { key: "letterboxd", link: (...a: unknown[]) => providerLink(...a), fetch: (...a: unknown[]) => providerFetch(...a) };
  const keys = ["LETTERBOXD", "GOODREADS", "READWISE", "ANILIST", "TRAKT", "HARDCOVER", "RAINDROP", "INSTAPAPER", "YOUTUBE"];
  return { ...actual, PROVIDERS: Object.fromEntries(keys.map((k) => [k, fake])) };
});

import {
  DAILY_SYNC_CAP,
  linkConnection,
  listPending,
  resolvePending,
  REFRESH_AFTER_MS,
  runConnectionsJob,
  syncConnection,
} from "@/server/services/connections";

type Row = Record<string, unknown> & { id: string; syncingSince: Date | null; lastSyncedAt: Date | null; cursor: string | null };

function fakeDb(mode: "ASK" | "AUTO" = "AUTO", plan: "FREE" | "PLUS" = "PLUS") {
  const connections: Row[] = [];
  const items: { id?: string; connectionId: string; externalId: string; capturedItemId: string | null; status?: string; group?: string | null; title?: string | null; payload?: unknown; createdAt?: Date }[] = [];
  let itemSeq = 0;
  const itemMatches = (i: (typeof items)[number], where: Record<string, unknown>): boolean => {
    if (where.connectionId && i.connectionId !== where.connectionId) return false;
    if (where.id && i.id !== where.id) return false;
    if (where.group && i.group !== where.group) return false;
    if (where.status && (i.status ?? "ADDED") !== where.status) return false;
    if (where.payload && (where.payload as { not?: unknown }).not !== undefined && i.payload == null) return false;
    if (where.externalId && !(where.externalId as { in: string[] }).in.includes(i.externalId)) return false;
    if (where.capturedItemId && (where.capturedItemId as { not?: unknown }).not === null && !i.capturedItemId) return false;
    if (where.connection) {
      const c = connections.find((r) => r.id === i.connectionId);
      const w = where.connection as { userId?: string; provider?: string };
      if (!c || (w.userId && c.userId !== w.userId) || (w.provider && c.provider !== w.provider)) return false;
    }
    return true;
  };
  const leases: { name: string; heldUntil: Date; heldBy: string }[] = [];
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (where.id && row.id !== where.id) return false;
    if (where.userId && row.userId !== where.userId) return false;
    if (where.provider && row.provider !== where.provider) return false;
    if (Array.isArray(where.OR)) {
      return (where.OR as Record<string, unknown>[]).some((clause) => matches(row, clause));
    }
    if ("syncingSince" in where) {
      const w = where.syncingSince as null | { lt: Date };
      if (w === null) return row.syncingSince === null;
      return row.syncingSince !== null && row.syncingSince < w.lt;
    }
    if ("lastSyncedAt" in where) {
      const w = where.lastSyncedAt as null | { lt: Date };
      if (w === null) return row.lastSyncedAt === null;
      return row.lastSyncedAt !== null && row.lastSyncedAt < w.lt;
    }
    return true;
  };

  const db = {
    connection: {
      findMany: async (args: { where: Record<string, unknown>; take?: number }) => {
        const rows = connections.filter((r) => matches(r, args.where));
        rows.sort((a, b) => (a.lastSyncedAt?.getTime() ?? -1) - (b.lastSyncedAt?.getTime() ?? -1));
        return (args.take ? rows.slice(0, args.take) : rows).map((r) => ({ ...r }));
      },
      findUnique: async (args: { where: { id?: string; userId_provider?: { userId: string; provider: string } } }) => {
        const w = args.where.userId_provider ? { userId: args.where.userId_provider.userId, provider: args.where.userId_provider.provider } : { id: args.where.id };
        const row = connections.find((r) => matches(r, w));
        return row ? { ...row } : null;
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = connections.filter((r) => matches(r, args.where));
        rows.forEach((r) => Object.assign(r, args.data));
        return { count: rows.length };
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = connections.find((r) => r.id === args.where.id)!;
        Object.assign(row, args.data);
        return { ...row };
      },
      create: async (args: { data: Record<string, unknown> }) => {
        const row: Row = {
          id: `c${++seq}`,
          status: "OK",
          lastError: null,
          lastSyncedAt: null,
          lastSync: null,
          cursor: null,
          label: null,
          secret: null,
          syncingSince: null,
          createdAt: new Date("2026-08-01T00:00:00Z"),
          ...args.data,
        };
        connections.push(row);
        return { ...row };
      },
      count: async (args: { where: Record<string, unknown> }) => connections.filter((r) => matches(r, args.where)).length,
      deleteMany: async () => ({ count: 0 }),
    },
    connectionItem: {
      findMany: async (args: { where: Record<string, unknown> }) =>
        items.filter((i) => itemMatches(i, args.where)).map((i) => ({ ...i, connection: connections.find((r) => r.id === i.connectionId) })),
      createMany: async (args: { data: typeof items }) => {
        for (const d of args.data) {
          if (!items.some((i) => i.connectionId === d.connectionId && i.externalId === d.externalId)) {
            items.push({ id: `i${++itemSeq}`, status: "ADDED", payload: null, createdAt: new Date(), ...d });
          }
        }
        return { count: args.data.length };
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rows = items.filter((i) => itemMatches(i, args.where));
        // Prisma.DbNull is a sentinel object that Postgres stores as NULL.
        const data = { ...args.data, ...("payload" in args.data && typeof args.data.payload === "object" ? { payload: null } : {}) };
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      deleteMany: async () => ({ count: 0 }),
      groupBy: async (args: { where: Record<string, unknown> }) => {
        const counts = new Map<string, number>();
        for (const i of items) if (itemMatches(i, args.where)) counts.set(i.connectionId, (counts.get(i.connectionId) ?? 0) + 1);
        return [...counts].map(([connectionId, n]) => ({ connectionId, _count: { _all: n } }));
      },
    },
    userPreference: {
      findUnique: async () => ({ connectionsMode: mode }),
    },
    user: {
      findUnique: async () => ({ plan }),
    },
    jobLease: {
      updateMany: async (args: { where: { name: string; heldUntil?: { lte: Date }; heldBy?: string }; data: Record<string, unknown> }) => {
        const row = leases.find((r) => r.name === args.where.name);
        if (!row) return { count: 0 };
        if (args.where.heldUntil && row.heldUntil > args.where.heldUntil.lte) return { count: 0 };
        if (args.where.heldBy !== undefined && row.heldBy !== args.where.heldBy) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
      create: async (args: { data: { name: string; heldUntil: Date; heldBy: string } }) => {
        if (leases.some((r) => r.name === args.data.name)) throw new Error("dup");
        leases.push({ ...args.data });
        return args.data;
      },
    },
  };
  return { db: db as unknown as typeof db & DbClient, connections, items };
}

const NOW = new Date("2026-08-23T12:00:00Z");

function item(id: string, words = "a real sentence about the film", daysAgo = 3) {
  return {
    externalId: id,
    title: `Film ${id}`,
    url: `https://letterboxd.com/u/film/${id}/`,
    words,
    rating: "★★★★",
    occurredAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
  };
}

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "a-secret-long-enough-for-tests");
  let n = 0;
  captureItem.mockImplementation(async () => ({ id: `cap${++n}` }));
  createManualContentItem.mockImplementation(async (input: { title: string }) => ({ id: `content-${input.title}` }));
  providerLink.mockResolvedValue({ handle: "dave", label: "Dave" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("syncConnection", () => {
  it("captures each entry with words once, backdated, and records the tally", async () => {
    const { db, connections, items } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "LETTERBOXD", handle: "dave" } });
    providerFetch.mockResolvedValue({ label: "Dave Vis", seen: 5, items: [item("r1"), item("r2", "second thought here", 10)] });

    const tally = await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });

    expect(tally).toEqual({ seen: 5, withWords: 2, mapped: 2, failed: 0, skipped: 0, staged: 0 });
    expect(captureItem).toHaveBeenCalledTimes(2);
    // Oldest first.
    expect(captureItem.mock.calls[0][0]).toMatchObject({
      kind: "LINK",
      origin: "letterboxd",
      contentItemId: "content-Film r2",
      reaction: "★★★★\n\nsecond thought here",
      capturedAt: new Date(NOW.getTime() - 10 * 86_400_000),
    });
    expect(items.map((i) => i.externalId).sort()).toEqual(["r1", "r2"]);
    expect(connections[0]).toMatchObject({ status: "OK", lastError: null, lastSyncedAt: NOW, syncingSince: null, label: "Dave Vis" });

    // Second pass: nothing new.
    await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });
    expect(captureItem).toHaveBeenCalledTimes(2);
    expect(connections[0].lastSync).toMatchObject({ mapped: 0, withWords: 2 });
  });

  it("caps a pass at the newest entries, keeps the older ones for next time, and holds the cursor", async () => {
    const { db, connections } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "READWISE", handle: "token", cursor: "old" } });
    // Readwise goes through fetchWithLedger; make the provider's fetch path the
    // one under test by linking as letterboxd instead.
    connections[0].provider = "LETTERBOXD";
    providerFetch.mockResolvedValue({ label: null, seen: 3, items: [item("a", "w x", 30), item("b", "w x", 20), item("c", "w x", 10)], cursor: "new" });

    const tally = await syncConnection({ connectionId: "c1", cap: 2, db, now: NOW });
    expect(tally).toMatchObject({ mapped: 2, skipped: 1 });
    expect(captureItem.mock.calls.map((c) => (c[0] as { url: string }).url)).toEqual([
      "https://letterboxd.com/u/film/b/",
      "https://letterboxd.com/u/film/c/",
    ]);
    expect(connections[0].cursor).toBe("old");

    const again = await syncConnection({ connectionId: "c1", cap: 2, db, now: NOW });
    expect(again).toMatchObject({ mapped: 1, skipped: 0 });
    expect(connections[0].cursor).toBe("new");
  });

  it("turns a provider failure into a sentence on the row and still advances lastSyncedAt", async () => {
    const { db, connections } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "GOODREADS", handle: "1" } });
    const { ProviderError } = await import("@/server/connections");
    providerFetch.mockRejectedValue(new ProviderError("PRIVATE", "that goodreads shelf is private — make it public"));

    await syncConnection({ connectionId: "c1", cap: 10, db, now: NOW });
    expect(connections[0]).toMatchObject({
      status: "ERROR",
      lastError: "that goodreads shelf is private — make it public",
      lastSyncedAt: NOW,
      syncingSince: null,
    });
  });

  it("counts a capture that throws as failed and carries on", async () => {
    const { db, items } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "LETTERBOXD", handle: "dave" } });
    providerFetch.mockResolvedValue({ label: null, seen: 2, items: [item("bad"), item("good")] });
    captureItem.mockImplementation(async (p: { url: string }) => {
      if (p.url.includes("bad")) throw new Error("boom");
      return { id: "ok" };
    });

    const tally = await syncConnection({ connectionId: "c1", cap: 10, db, now: NOW });
    expect(tally).toMatchObject({ mapped: 1, failed: 1 });
    expect(items.map((i) => i.externalId)).toEqual(["good"]); // the failed one is not ledgered, so it is retried next pass
  });

  it("runs a link-mode item through the ordinary pipeline with no content item of its own", async () => {
    const { db } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "YOUTUBE", handle: "PL1" } });
    providerFetch.mockResolvedValue({ label: "Playlist", seen: 1, items: [{ ...item("yt-1", ""), mode: "link" }] });

    const tally = await syncConnection({ connectionId: "c1", cap: 10, db, now: NOW });
    expect(tally).toMatchObject({ mapped: 1 });
    expect(createManualContentItem).not.toHaveBeenCalled();
    expect(captureItem.mock.calls[0][0]).toMatchObject({ kind: "LINK", url: "https://letterboxd.com/u/film/yt-1/", origin: "youtube" });
    expect((captureItem.mock.calls[0][0] as { contentItemId?: string }).contentItemId).toBeUndefined();
    expect((captureItem.mock.calls[0][0] as { reaction?: string }).reaction).toBeUndefined();
  });

  it("stands down when another sync holds the row", async () => {
    const { db } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "LETTERBOXD", handle: "dave", syncingSince: NOW } });
    expect(await syncConnection({ connectionId: "c1", cap: 10, db, now: NOW })).toBeNull();
    expect(providerFetch).not.toHaveBeenCalled();
  });
});

describe("linkConnection", () => {
  it("validates with the provider, stores, and starts the first sync", async () => {
    const { db, connections } = fakeDb();
    providerFetch.mockResolvedValue({ label: "Dave", seen: 0, items: [] });

    const view = await linkConnection({ userId: "u1", provider: "letterboxd", input: "https://letterboxd.com/dave/", db });
    expect(providerLink).toHaveBeenCalledWith("https://letterboxd.com/dave/");
    expect(view).toMatchObject({ provider: "letterboxd", handle: "dave", label: "Dave", syncing: true, mapped: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(providerFetch).toHaveBeenCalledTimes(1);
    expect(connections[0].lastSyncedAt).not.toBeNull();
  });

  it("rejects unknown providers before touching the network", async () => {
    const { db } = fakeDb();
    await expect(linkConnection({ userId: "u1", provider: "spotify", input: "x", db })).rejects.toMatchObject({ code: "UNKNOWN_PROVIDER" });
    expect(providerLink).not.toHaveBeenCalled();
  });

  it("caps FREE at FREE_CONNECTION_LIMIT linked accounts, without calling the provider; re-linking stays free and PLUS is uncapped", async () => {
    const { db } = fakeDb("AUTO", "FREE");
    providerLink.mockResolvedValue({ handle: "dave", label: "Dave" });
    await linkConnection({ userId: "u1", provider: "letterboxd", input: "dave", db });
    await linkConnection({ userId: "u1", provider: "goodreads", input: "dave", db });

    providerLink.mockClear();
    await expect(linkConnection({ userId: "u1", provider: "trakt", input: "dave", db })).rejects.toMatchObject({ code: "CONNECTION_LIMIT" });
    expect(providerLink).not.toHaveBeenCalled();

    // Swapping the account behind an existing provider is never a new slot.
    providerLink.mockResolvedValue({ handle: "dave2", label: "Dave 2" });
    await expect(linkConnection({ userId: "u1", provider: "letterboxd", input: "dave2", db })).resolves.toMatchObject({ handle: "dave2" });

    const plus = fakeDb("AUTO", "PLUS");
    for (const provider of ["letterboxd", "goodreads", "trakt"]) {
      await linkConnection({ userId: "u1", provider, input: "dave", db: plus.db });
    }
    expect(plus.connections).toHaveLength(3);
  });
});

describe("work resolution", () => {
  it("fills a words item's missing description from the resolver, without touching its url", async () => {
    const { db, connections } = fakeDb();
    connections.push({ id: "c1", userId: "u1", provider: "LETTERBOXD", handle: "dave", secret: null, status: "OK", lastError: null, syncingSince: null, lastSyncedAt: null, lastSync: null, cursor: null, label: null, createdAt: new Date("2026-08-01T00:00:00Z") });
    resolveWork.mockResolvedValueOnce({ url: "https://en.wikipedia.org/wiki/Face/Off", title: "Face/Off", description: "A 1997 action film…" } as never);
    providerFetch.mockResolvedValue({ label: "Dave", seen: 1, items: [item("r1")] });
    await syncConnection({ connectionId: "c1", cap: 10, db, now: NOW });
    expect(resolveWork).toHaveBeenCalledWith(expect.objectContaining({ kind: "film" }));
    const manual = createManualContentItem.mock.calls.at(-1)?.[0] as { description?: string; canonicalUrl?: string };
    expect(manual.description).toBe("A 1997 action film…");
    expect(manual.canonicalUrl).toContain("letterboxd.com");
  });

  it("a resolver miss leaves the item exactly as it was", async () => {
    const { db, connections } = fakeDb();
    connections.push({ id: "c1", userId: "u1", provider: "LETTERBOXD", handle: "dave", secret: null, status: "OK", lastError: null, syncingSince: null, lastSyncedAt: null, lastSync: null, cursor: null, label: null, createdAt: new Date("2026-08-01T00:00:00Z") });
    resolveWork.mockResolvedValueOnce(null as never);
    providerFetch.mockResolvedValue({ label: "Dave", seen: 1, items: [item("r1")] });
    await syncConnection({ connectionId: "c1", cap: 10, db, now: NOW });
    const manual = createManualContentItem.mock.calls.at(-1)?.[0] as { description?: string };
    expect(manual.description).toBeUndefined();
  });
});

describe("runConnectionsJob", () => {
  it("refreshes only connections not checked in REFRESH_AFTER_MS, oldest first, at the daily cap", async () => {
    const { db, connections } = fakeDb();
    await db.connection.create({ data: { userId: "u1", provider: "LETTERBOXD", handle: "a", lastSyncedAt: new Date(NOW.getTime() - REFRESH_AFTER_MS - 1000) } });
    await db.connection.create({ data: { userId: "u2", provider: "LETTERBOXD", handle: "b", lastSyncedAt: new Date(NOW.getTime() - 60_000) } });
    await db.connection.create({ data: { userId: "u3", provider: "LETTERBOXD", handle: "c" } });
    providerFetch.mockResolvedValue({ label: null, seen: 1, items: [item("x")] });

    const result = await runConnectionsJob({ db, now: NOW });
    expect(result).toMatchObject({ ran: true, due: 2, synced: 2, mapped: 2, failed: 0 });
    expect(connections.map((c) => c.lastSyncedAt?.getTime())).toEqual([NOW.getTime(), NOW.getTime() - 60_000, NOW.getTime()]);
    expect(DAILY_SYNC_CAP).toBeLessThan(100);
  });

  it("stands down when the lease is held", async () => {
    const { db } = fakeDb();
    await db.jobLease.create({
      data: { name: "connections:hourly", heldUntil: new Date(NOW.getTime() + 60_000), heldBy: "other" },
    });
    expect(await runConnectionsJob({ db, now: NOW })).toMatchObject({ ran: false });
  });
});

describe("ask-me-first mode", () => {
  it("stages finds instead of mapping them, and the pill can add or decline them", async () => {
    const { db, connections, items } = fakeDb("ASK");
    await db.connection.create({ data: { userId: "u1", provider: "LETTERBOXD", handle: "dave" } });
    providerFetch.mockResolvedValue({ label: "Dave", seen: 3, items: [item("r1", "first real thought"), item("r2", "second real thought", 5)] });

    const tally = await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });
    expect(tally).toMatchObject({ withWords: 2, mapped: 0, staged: 2 });
    expect(captureItem).not.toHaveBeenCalled();
    expect(items.map((i) => i.status)).toEqual(["PENDING", "PENDING"]);

    const pending = await listPending({ userId: "u1", db });
    expect(pending).toMatchObject({ total: 2, adding: false });
    expect(pending.groups[0]).toMatchObject({ provider: "letterboxd", count: 2 });
    expect(pending.groups[0].titles).toContain("Film r1");

    // A second sync offers nothing new: the ledger already holds them.
    await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });
    expect(items).toHaveLength(2);

    const after = await resolvePending({ userId: "u1", action: "add", db });
    expect(after.adding).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(captureItem).toHaveBeenCalledTimes(2);
    expect(captureItem.mock.calls.map((c) => (c[0] as { reaction: string }).reaction)).toContain("★★★★\n\nfirst real thought");
    expect(captureItem.mock.calls.every((c) => (c[0] as { origin: string }).origin === "letterboxd")).toBe(true);
    expect(items.every((i) => i.status === "ADDED" && i.capturedItemId && i.payload == null)).toBe(true);
    expect((await listPending({ userId: "u1", db })).total).toBe(0);
    expect(connections[0].status).toBe("OK");
  });

  it("decline keeps the rows so the finds are never offered again", async () => {
    const { db, items } = fakeDb("ASK");
    await db.connection.create({ data: { userId: "u1", provider: "GOODREADS", handle: "1" } });
    providerFetch.mockResolvedValue({ label: null, seen: 1, items: [item("g1", "a whole review here")] });
    await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });

    await resolvePending({ userId: "u1", action: "decline", provider: "goodreads", db });
    expect(items[0].status).toBe("DECLINED");
    expect((await listPending({ userId: "u1", db })).total).toBe(0);
    await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });
    expect(items).toHaveLength(1);
    expect(captureItem).not.toHaveBeenCalled();
  });

  it("keeps one payload per multi-key item and marks the whole group on add", async () => {
    const { db, items } = fakeDb("ASK");
    await db.connection.create({ data: { userId: "u1", provider: "LETTERBOXD", handle: "dave" } });
    providerFetch.mockResolvedValue({ label: null, seen: 2, items: [{ ...item("rw-1,rw-2", "my note"), quote: "two passages" }] });
    await syncConnection({ connectionId: "c1", cap: 100, db, now: NOW });
    expect(items.map((i) => [i.externalId, i.payload != null])).toEqual([["rw-1", true], ["rw-2", false]]);
    expect((await listPending({ userId: "u1", db })).total).toBe(1);
    await resolvePending({ userId: "u1", action: "add", db });
    await new Promise((r) => setTimeout(r, 20));
    expect(captureItem).toHaveBeenCalledTimes(1);
    expect(items.every((i) => i.status === "ADDED")).toBe(true);
  });
});
