import { ConnectionItemStatus, ConnectionProvider, ConnectionStatus, Prisma, type Connection } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { PROVIDERS, ProviderError, type ProviderFeed, type ProviderItem } from "@/server/connections";
import { readwise } from "@/server/connections/readwise";
import { openSecret, sealSecret } from "@/server/connections/secret";
import type { DbClient } from "@/server/db";
import { captureProviderItem, type CaptureSite } from "@/server/services/capture-items";
import { withLease } from "@/server/services/jobs";

/**
 * Connected accounts: link → first sync now; then an hourly job refreshes
 * each connection about once a day. Every provider entry with the person's
 * own words becomes one capture, built from the feed without scraping.
 * Design: docs/design/2026-08-23-account-connections-design.md
 */

export const CONNECTIONS_JOB_LEASE = "connections:hourly";
/** How stale a connection must be before the hourly job refreshes it. Under 24h so a full day never races the fixed-hour schedule. */
export const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;
/** Connections per hourly tick. */
export const JOB_BATCH = 150;
/** Connections in flight at once inside the job. */
const JOB_CONCURRENCY = 2;
/** New captures per connection: the first sync after linking, then each daily pass. */
export const FIRST_SYNC_CAP = 100;
export const DAILY_SYNC_CAP = 40;
/** Linked accounts a FREE user may keep in sync at once; PLUS is uncapped. */
export const FREE_CONNECTION_LIMIT = 2;
/** A `syncingSince` older than this is a run that died; treat the connection as idle. */
export const SYNC_STALE_MS = 30 * 60 * 1000;
/** Items captured concurrently within one sync — the same two lanes import uses. */
const ITEM_CONCURRENCY = 2;

export type SyncTally = { seen: number; withWords: number; mapped: number; failed: number; skipped: number; staged: number };

export type ConnectionView = {
  provider: Lowercase<ConnectionProvider>;
  handle: string;
  /** When set, the phone fetches this itself and posts the body to sync (see Provider.deviceFeed). */
  deviceFeed: { url: string; headers?: Record<string, string> } | null;
  label: string | null;
  status: Lowercase<ConnectionStatus>;
  lastError: string | null;
  lastSyncedAt: string | null;
  lastSync: SyncTally | null;
  syncing: boolean;
  /** Captures this connection has put on the map, all time. */
  mapped: number;
  /** Finds waiting for a yes (ASK mode). */
  pending: number;
  createdAt: string;
};

const PROVIDER_KEYS = Object.keys(PROVIDERS) as ConnectionProvider[];

export function toProviderEnum(value: string): ConnectionProvider {
  const upper = value.toUpperCase() as ConnectionProvider;
  if (!PROVIDER_KEYS.includes(upper)) {
    throw new AppError("UNKNOWN_PROVIDER", "That isn't something mneme can connect to yet.", 422);
  }
  return upper;
}

function isSyncing(row: Pick<Connection, "syncingSince">, now = new Date()): boolean {
  return !!row.syncingSince && now.getTime() - row.syncingSince.getTime() < SYNC_STALE_MS;
}

async function serialize(rows: Connection[], db: DbClient): Promise<ConnectionView[]> {
  const counts = rows.length
    ? await db.connectionItem.groupBy({
        by: ["connectionId"],
        where: { connectionId: { in: rows.map((r) => r.id) }, capturedItemId: { not: null } },
        _count: { _all: true },
      })
    : [];
  const mappedBy = new Map(counts.map((c) => [c.connectionId, c._count._all]));
  const pendingRows = rows.length
    ? await db.connectionItem.groupBy({
        by: ["connectionId"],
        where: { connectionId: { in: rows.map((r) => r.id) }, status: ConnectionItemStatus.PENDING, payload: { not: Prisma.DbNull } },
        _count: { _all: true },
      })
    : [];
  const pendingBy = new Map(pendingRows.map((c) => [c.connectionId, c._count._all]));
  return rows.map((row) => ({
    provider: row.provider.toLowerCase() as Lowercase<ConnectionProvider>,
    handle: row.handle,
    deviceFeed: PROVIDERS[row.provider].deviceFeed?.(row.handle) ?? null,
    label: row.label,
    status: row.status.toLowerCase() as Lowercase<ConnectionStatus>,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSync: (row.lastSync as SyncTally | null) ?? null,
    syncing: isSyncing(row),
    mapped: mappedBy.get(row.id) ?? 0,
    pending: pendingBy.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listConnections(args: { userId: string; db?: DbClient }): Promise<ConnectionView[]> {
  const db = args.db ?? prisma;
  const rows = await db.connection.findMany({ where: { userId: args.userId }, orderBy: { createdAt: "asc" } });
  return serialize(rows, db);
}

/**
 * Validate with the provider, store, and start the first sync in the
 * background. Re-linking the same provider replaces the account; if the
 * handle changed the ledger is cleared so the new account syncs from scratch
 * (captures from the old one stay on the map).
 */
export async function linkConnection(args: {
  userId: string;
  provider: string;
  input: string;
  db?: DbClient;
}): Promise<ConnectionView> {
  const db = args.db ?? prisma;
  const provider = toProviderEnum(args.provider);

  // The plan cap, checked before any outbound request: re-linking an account
  // you already have never counts against it, only a brand-new provider does.
  const existing = await db.connection.findUnique({ where: { userId_provider: { userId: args.userId, provider } } });
  if (!existing) {
    const [user, count] = await Promise.all([
      db.user.findUnique({ where: { id: args.userId }, select: { plan: true } }),
      db.connection.count({ where: { userId: args.userId } }),
    ]);
    if (user?.plan !== "PLUS" && count >= FREE_CONNECTION_LIMIT) {
      throw new AppError(
        "CONNECTION_LIMIT",
        `Free keeps ${FREE_CONNECTION_LIMIT} accounts in sync. Mneme Plus lifts the limit.`,
        403,
      );
    }
  }

  let linked: { handle: string; secret?: string; label: string | null };
  try {
    linked = await PROVIDERS[provider].link(args.input);
  } catch (error) {
    // A device-fed provider that turns the server away is still linkable:
    // the phone will do the fetching. Anything else is the person's to fix.
    const p = PROVIDERS[provider];
    if (p.deviceFeed && error instanceof ProviderError && error.code === "UNAVAILABLE") {
      const handle = args.input.trim().replace(/^(u\/|@)/i, "").replace(/.*\/(?:u|user)\//i, "").replace(/\/.*$/, "");
      linked = { handle, label: handle };
    } else throw error;
  }

  const data = {
    handle: linked.handle,
    label: linked.label,
    secret: linked.secret ? sealSecret(linked.secret) : null,
    status: ConnectionStatus.OK,
    lastError: null,
    syncingSince: null as Date | null,
  };

  let row: Connection;
  if (existing) {
    const changed = existing.handle !== linked.handle || !!linked.secret;
    row = await db.connection.update({
      where: { id: existing.id },
      data: { ...data, ...(changed ? { cursor: null, lastSyncedAt: null, lastSync: undefined } : {}) },
    });
    if (existing.handle !== linked.handle) {
      await db.connectionItem.deleteMany({ where: { connectionId: existing.id } });
    }
  } else {
    row = await db.connection.create({ data: { ...data, userId: args.userId, provider } });
  }

  void syncConnection({ connectionId: row.id, cap: FIRST_SYNC_CAP, db }).catch(() => {});
  const [view] = await serialize([{ ...row, syncingSince: new Date() }], db);
  return view;
}

export async function unlinkConnection(args: { userId: string; provider: string; db?: DbClient }): Promise<void> {
  const db = args.db ?? prisma;
  const provider = toProviderEnum(args.provider);
  await db.connection.deleteMany({ where: { userId: args.userId, provider } });
}

/** "check now": a one-tap retry for a failed state, or impatience. */
export async function requestSync(args: { userId: string; provider: string; feedText?: string; db?: DbClient }): Promise<ConnectionView> {
  const db = args.db ?? prisma;
  const provider = toProviderEnum(args.provider);
  const row = await db.connection.findUnique({ where: { userId_provider: { userId: args.userId, provider } } });
  if (!row) throw new AppError("NOT_FOUND", "That account isn't connected.", 404);
  if (isSyncing(row)) {
    const [view] = await serialize([row], db);
    return view;
  }
  void syncConnection({ connectionId: row.id, cap: FIRST_SYNC_CAP, db, feedText: args.feedText }).catch(() => {});
  const [view] = await serialize([{ ...row, syncingSince: new Date() }], db);
  return view;
}

/** The ledger keys an item occupies: one per Readwise highlight, one per review otherwise. */
function ledgerKeys(item: ProviderItem): string[] {
  return item.externalId.split(",");
}

async function fetchFeed(row: Connection, db: DbClient): Promise<ProviderFeed> {
  const secret = row.secret ? openSecret(row.secret) : null;
  if (row.provider === ConnectionProvider.READWISE) {
    if (!secret) throw new ProviderError("BAD_TOKEN", "readwise needs reconnecting — paste a fresh token from readwise.io/access_token");
    const ledger = await db.connectionItem.findMany({ where: { connectionId: row.id }, select: { externalId: true } });
    return readwise.fetchWithLedger({ secret, cursor: row.cursor, alreadySeen: new Set(ledger.map((l) => l.externalId)) });
  }
  return PROVIDERS[row.provider].fetch({ handle: row.handle, secret, cursor: row.cursor });
}

export const SITE: Record<ConnectionProvider, CaptureSite> = {
  LETTERBOXD: { siteName: "Letterboxd", contentType: "film" },
  GOODREADS: { siteName: "Goodreads", contentType: "book" },
  READWISE: { siteName: "Readwise", contentType: "highlights" },
  ANILIST: { siteName: "AniList", contentType: "anime" },
  TRAKT: { siteName: "Trakt", contentType: "film" },
  HARDCOVER: { siteName: "Hardcover", contentType: "book" },
  RAINDROP: { siteName: "Raindrop", contentType: "article" },
  INSTAPAPER: { siteName: "Instapaper", contentType: "article" },
  YOUTUBE: { siteName: "YouTube", contentType: "video" },
  MASTODON: { siteName: "Mastodon", contentType: "post" },
  BLUESKY: { siteName: "Bluesky", contentType: "post" },
  TUMBLR: { siteName: "Tumblr", contentType: "post" },
  MEDIUM: { siteName: "Medium", contentType: "article" },
  SUBSTACK: { siteName: "Substack", contentType: "article" },
  BOOKWYRM: { siteName: "Bookwyrm", contentType: "book" },
  HACKERNEWS: { siteName: "Hacker News", contentType: "post" },
  REDDIT: { siteName: "Reddit", contentType: "post" },
  PINBOARD: { siteName: "Pinboard", contentType: "article" },
  ARENA: { siteName: "Are.na", contentType: "post" },
  ZOTERO: { siteName: "Zotero", contentType: "paper" },
  GITHUB: { siteName: "GitHub", contentType: "repository" },
  KITSU: { siteName: "Kitsu", contentType: "anime" },
  STEAM: { siteName: "Steam", contentType: "game" },
  BACKLOGGD: { siteName: "Backloggd", contentType: "game" },
  RAWG: { siteName: "RAWG", contentType: "game" },
  LISTENBRAINZ: { siteName: "ListenBrainz", contentType: "music" },
  BANDCAMP: { siteName: "Bandcamp", contentType: "music" },
};

async function captureOne(row: Connection, item: ProviderItem, now: Date, db: DbClient): Promise<string> {
  return captureProviderItem({ userId: row.userId, origin: row.provider.toLowerCase(), site: SITE[row.provider], item, now, db });
}

/**
 * Pull the feed, drop what the ledger already has, capture up to `cap`, record
 * the rest of the tally. Never throws: every outcome lands on the row, where
 * the screen (and the next job run) can read it.
 */
export async function syncConnection(args: {
  connectionId: string;
  cap: number;
  db?: DbClient;
  now?: Date;
  /** A feed body the phone fetched, for providers with `deviceFeed`. */
  feedText?: string;
}): Promise<SyncTally | null> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();

  // Claim the row. The conditional update is the mutex: a second caller sees
  // count 0 and stands down.
  const claimed = await db.connection.updateMany({
    where: {
      id: args.connectionId,
      OR: [{ syncingSince: null }, { syncingSince: { lt: new Date(now.getTime() - SYNC_STALE_MS) } }],
    },
    data: { syncingSince: now },
  });
  if (claimed.count === 0) return null;

  const row = await db.connection.findUnique({ where: { id: args.connectionId } });
  if (!row) return null;

  const tally: SyncTally = { seen: 0, withWords: 0, mapped: 0, failed: 0, skipped: 0, staged: 0 };
  let cursor = row.cursor;

  try {
    const [feed, pref] = await Promise.all([
      args.feedText !== undefined && PROVIDERS[row.provider].parse ? Promise.resolve(PROVIDERS[row.provider].parse!(args.feedText)) : fetchFeed(row, db),
      db.userPreference.findUnique({ where: { userId: row.userId }, select: { connectionsMode: true } }),
    ]);
    const ask = (pref?.connectionsMode ?? "ASK") === "ASK";
    tally.seen = feed.seen;
    tally.withWords = feed.items.length;
    if (feed.cursor !== undefined) cursor = feed.cursor;

    const keys = feed.items.flatMap(ledgerKeys);
    const known = new Set(
      keys.length
        ? (
            await db.connectionItem.findMany({
              where: { connectionId: row.id, externalId: { in: keys } },
              select: { externalId: true },
            })
          ).map((r) => r.externalId)
        : [],
    );
    const fresh = feed.items.filter((item) => !ledgerKeys(item).some((k) => known.has(k)));
    // Oldest first, so a capped first sync lays down history in order and a
    // later pass picks up where it left off.
    fresh.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const batch = fresh.slice(-args.cap);
    tally.skipped = fresh.length - batch.length;

    if (ask) {
      // Stage, don't map: the find waits in the ledger with everything needed
      // to capture it later, and the Atlas pill asks next time they're there.
      await db.connectionItem.createMany({
        data: batch.flatMap((item) => stagedRows(row.id, item)),
        skipDuplicates: true,
      });
      tally.staged = batch.length;
    } else {
      let next = 0;
      const lane = async () => {
        while (next < batch.length) {
          const item = batch[next++];
          try {
            const capturedItemId = await captureOne(row, item, now, db);
            await db.connectionItem.createMany({
              data: ledgerKeys(item).map((externalId) => ({ connectionId: row.id, externalId, capturedItemId })),
              skipDuplicates: true,
            });
            tally.mapped += 1;
          } catch (error) {
            tally.failed += 1;
            console.error(JSON.stringify({ event: "connection_item_failed", provider: row.provider, connectionId: row.id, error: error instanceof Error ? error.message : String(error) }));
          }
        }
      };
      await Promise.all(Array.from({ length: ITEM_CONCURRENCY }, lane));
    }

    await db.connection.update({
      where: { id: row.id },
      data: {
        status: ConnectionStatus.OK,
        lastError: null,
        lastSyncedAt: now,
        lastSync: tally,
        // A capped pass must not advance the cursor past what it skipped.
        cursor: tally.skipped > 0 ? row.cursor : cursor,
        label: feed.label ?? row.label,
        syncingSince: null,
      },
    });
  } catch (error) {
    const message =
      error instanceof ProviderError
        ? error.message
        : `${row.provider.toLowerCase()} couldn't be checked — mneme will try again tomorrow`;
    await db.connection.update({
      where: { id: row.id },
      data: { status: ConnectionStatus.ERROR, lastError: message, lastSyncedAt: now, lastSync: tally, syncingSince: null },
    });
    console.error(JSON.stringify({ event: "connection_sync_failed", provider: row.provider, connectionId: row.id, error: error instanceof Error ? error.message : String(error) }));
  }

  return tally;
}

/** A find, serialised into the ledger so "add" never has to refetch. */
type StoredItem = Omit<ProviderItem, "occurredAt"> & { occurredAt: string };

function stagedRows(connectionId: string, item: ProviderItem): Prisma.ConnectionItemCreateManyInput[] {
  const stored: StoredItem = { ...item, occurredAt: item.occurredAt.toISOString() };
  return ledgerKeys(item).map((externalId, i) => ({
    connectionId,
    externalId,
    status: ConnectionItemStatus.PENDING,
    group: item.externalId,
    title: item.title,
    payload: i === 0 ? (stored as unknown as Prisma.InputJsonValue) : undefined,
  }));
}

function restoreItem(payload: Prisma.JsonValue): ProviderItem {
  const stored = payload as unknown as StoredItem;
  return { ...stored, occurredAt: new Date(stored.occurredAt) };
}

export type PendingFinds = {
  total: number;
  groups: { provider: Lowercase<ConnectionProvider>; count: number; titles: string[] }[];
  /** True while an "add" is still mapping in the background. */
  adding: boolean;
};

/** Users with an "add" in flight, so the client can tell "still mapping" from "nothing left". */
const addingUsers = new Set<string>();

export async function listPending(args: { userId: string; db?: DbClient }): Promise<PendingFinds> {
  const db = args.db ?? prisma;
  const rows = await db.connectionItem.findMany({
    where: { connection: { userId: args.userId }, status: ConnectionItemStatus.PENDING, payload: { not: Prisma.DbNull } },
    select: { title: true, connection: { select: { provider: true } } },
    orderBy: { createdAt: "desc" },
  });
  const byProvider = new Map<ConnectionProvider, { count: number; titles: string[] }>();
  for (const r of rows) {
    const g = byProvider.get(r.connection.provider) ?? { count: 0, titles: [] };
    g.count += 1;
    if (g.titles.length < 3 && r.title) g.titles.push(r.title);
    byProvider.set(r.connection.provider, g);
  }
  return {
    total: rows.length,
    groups: [...byProvider.entries()].map(([provider, g]) => ({ provider: provider.toLowerCase() as Lowercase<ConnectionProvider>, ...g })),
    adding: addingUsers.has(args.userId),
  };
}

/**
 * The pill's answer. "decline" is final for these finds — the rows stay, so
 * they are never offered again. "add" maps them in the background through the
 * same path AUTO mode uses; the client polls listPending until `adding` drops.
 */
export async function resolvePending(args: {
  userId: string;
  action: "add" | "decline";
  provider?: string;
  db?: DbClient;
}): Promise<PendingFinds> {
  const db = args.db ?? prisma;
  const provider = args.provider ? toProviderEnum(args.provider) : undefined;
  const scope = { connection: { userId: args.userId, ...(provider ? { provider } : {}) }, status: ConnectionItemStatus.PENDING };

  if (args.action === "decline") {
    await db.connectionItem.updateMany({ where: scope, data: { status: ConnectionItemStatus.DECLINED } });
    return listPending({ userId: args.userId, db });
  }

  if (!addingUsers.has(args.userId)) {
    addingUsers.add(args.userId);
    void addPending(args.userId, provider, db)
      .catch((error) => console.error(JSON.stringify({ event: "connection_add_failed", userId: args.userId, error: error instanceof Error ? error.message : String(error) })))
      .finally(() => addingUsers.delete(args.userId));
  }
  return { ...(await listPending({ userId: args.userId, db })), adding: true };
}

async function addPending(userId: string, provider: ConnectionProvider | undefined, db: DbClient): Promise<void> {
  const now = new Date();
  const rows = await db.connectionItem.findMany({
    where: { connection: { userId, ...(provider ? { provider } : {}) }, status: ConnectionItemStatus.PENDING, payload: { not: Prisma.DbNull } },
    select: { id: true, connectionId: true, group: true, payload: true, connection: true },
    orderBy: { createdAt: "asc" },
  });
  let next = 0;
  const lane = async () => {
    while (next < rows.length) {
      const r = rows[next++];
      const groupWhere = { connectionId: r.connectionId, group: r.group ?? undefined, ...(r.group ? {} : { id: r.id }) };
      try {
        const capturedItemId = await captureOne(r.connection, restoreItem(r.payload as Prisma.JsonValue), now, db);
        await db.connectionItem.updateMany({ where: groupWhere, data: { status: ConnectionItemStatus.ADDED, capturedItemId, payload: Prisma.DbNull } });
      } catch (error) {
        // A find that cannot be captured (dead page, refused host) is not
        // worth asking about again.
        await db.connectionItem.updateMany({ where: groupWhere, data: { status: ConnectionItemStatus.DECLINED, payload: Prisma.DbNull } });
        console.error(JSON.stringify({ event: "connection_item_failed", provider: r.connection.provider, connectionId: r.connectionId, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  };
  await Promise.all(Array.from({ length: ITEM_CONCURRENCY }, lane));
}

export type ConnectionsJobResult = {
  ran: boolean;
  due: number;
  synced: number;
  mapped: number;
  failed: number;
};

/** The hourly tick: refresh every connection not checked in REFRESH_AFTER_MS, oldest first. */
export async function runConnectionsJob(args: { db?: DbClient; now?: Date } = {}): Promise<ConnectionsJobResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const started = Date.now();

  const outcome = await withLease(
    CONNECTIONS_JOB_LEASE,
    async () => {
      const due = await db.connection.findMany({
        where: {
          OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - REFRESH_AFTER_MS) } }],
        },
        orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
        take: JOB_BATCH,
        select: { id: true },
      });

      const result = { due: due.length, synced: 0, mapped: 0, failed: 0 };
      let next = 0;
      const lane = async () => {
        while (next < due.length) {
          const { id } = due[next++];
          const tally = await syncConnection({ connectionId: id, cap: DAILY_SYNC_CAP, db, now });
          if (tally) {
            result.synced += 1;
            result.mapped += tally.mapped;
            result.failed += tally.failed;
          }
        }
      };
      await Promise.all(Array.from({ length: JOB_CONCURRENCY }, lane));
      return result;
    },
    db,
    now,
  );

  const result: ConnectionsJobResult = outcome.ran
    ? { ran: true, ...outcome.result }
    : { ran: false, due: 0, synced: 0, mapped: 0, failed: 0 };
  console.error(JSON.stringify({ event: "connections_cron", ...result, ms: Date.now() - started }));
  return result;
}
