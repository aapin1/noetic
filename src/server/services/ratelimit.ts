import { prisma } from "@/lib/prisma";
import { retryableError } from "@/lib/api";
import type { DbClient } from "@/server/db";

/**
 * Abuse ceilings for the API.
 *
 * These are NOT the user-visible quotas — those live in `usage.ts` and are a
 * monetization concern. Everything here is sized well above what real use
 * reaches, so a normal user never sees a 429; the job is to stop one client
 * from consuming the whole instance.
 *
 * Two backends:
 *   - `enforceRateLimit`         in-process sliding window. Cheap, no I/O.
 *   - `enforceDurableRateLimit`  Postgres fixed window. Survives restarts and
 *                                holds across instances.
 *
 * The in-process one is right for per-user limits on authenticated routes: the
 * caller already proved who they are, and the worst case of a reset window is
 * that one authenticated user gets a few extra requests. The durable one is for
 * the unauthenticated auth routes, where a reset window is a security hole.
 */

const RATE_LIMIT_MESSAGE = "You're going a little fast — try again in a minute.";

// ── in-process sliding window ───────────────────────────────────────────────

type Window = {
  /** Hit timestamps inside the current window, oldest first. */
  hits: number[];
  /** Last time this key was touched — drives both sweep and LRU eviction. */
  touchedAt: number;
};

const rateWindows = new Map<string, Window>();

/**
 * Ceiling on distinct tracked keys. Reached only if the sweep can't keep up
 * (a flood of one-shot keys, e.g. IP-keyed limiting under a botnet). Past this
 * we evict least-recently-touched keys, which is safe: evicting a key can only
 * ever forgive requests, never invent them, and the durable backend covers the
 * cases where forgiveness is a security problem.
 */
const MAX_TRACKED_KEYS = 20_000;

/** How often the sweep runs, at most — amortized over calls, no timer. */
const SWEEP_INTERVAL_MS = 60_000;

/** Longest window any caller uses; a key idle this long is certainly stale. */
const MAX_WINDOW_MS = 60 * 60_000;

let lastSweepAt = 0;

/**
 * Drops windows nothing has touched for longer than the longest window in use.
 *
 * The original implementation never did this: entries were pruned only when the
 * same key was hit again, so the map retained one array per (route, user) pair
 * seen since boot and grew without bound as the user base grew. That is the
 * exact shape of leak that only shows up once there are thousands of users.
 */
function sweep(now: number) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  for (const [key, window] of rateWindows) {
    if (now - window.touchedAt > MAX_WINDOW_MS) rateWindows.delete(key);
  }
}

/** Evict least-recently-touched keys until we're back under the cap. */
function evictOldest() {
  const overflow = rateWindows.size - MAX_TRACKED_KEYS;
  if (overflow <= 0) return;

  // Map iterates in insertion order, and we re-insert on every touch (see
  // `recordHit`), so the front of the iteration is the least recently touched.
  let removed = 0;
  for (const key of rateWindows.keys()) {
    rateWindows.delete(key);
    if (++removed >= overflow) break;
  }
}

/**
 * Throws when `key` has already used `limit` requests inside `windowMs`.
 *
 * The 429 carries `Retry-After` derived from the oldest hit still in the
 * window — the moment the caller actually regains a slot.
 */
export function enforceRateLimit(
  key: string,
  route: string,
  limit: number,
  windowMs: number,
): void {
  const mapKey = `${route}:${key}`;
  const now = Date.now();

  sweep(now);

  const existing = rateWindows.get(mapKey);
  const hits = existing ? existing.hits.filter((t) => now - t < windowMs) : [];

  if (hits.length >= limit) {
    // Keep the pruned window so the retry hint stays accurate, and refresh
    // recency so a client hammering a limit doesn't get evicted into a reset.
    rateWindows.delete(mapKey);
    rateWindows.set(mapKey, { hits, touchedAt: now });

    const oldest = hits[0] ?? now;
    throw retryableError("RATE_LIMIT", RATE_LIMIT_MESSAGE, 429, (oldest + windowMs - now) / 1000);
  }

  hits.push(now);
  // Delete-then-set moves the key to the back of the iteration order, which is
  // what makes `evictOldest` an LRU rather than a FIFO.
  rateWindows.delete(mapKey);
  rateWindows.set(mapKey, { hits, touchedAt: now });

  evictOldest();
}

/** Test seam: drop all in-process windows. */
export function resetRateLimits() {
  rateWindows.clear();
  lastSweepAt = 0;
}

/** Test/observability seam: how many keys are currently tracked. */
export function trackedKeyCount() {
  return rateWindows.size;
}

// ── durable fixed window ────────────────────────────────────────────────────

/** Start of the fixed window `now` falls into, for a given window length. */
function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Postgres-backed limiter for the routes where an in-memory window would be a
 * security hole — a restart or a second instance must not hand an attacker a
 * fresh budget.
 *
 * Fixed windows rather than sliding: a sliding window needs the timestamp of
 * every hit, and one row per bucket is far cheaper. The tradeoff is that a
 * caller can spend `limit` at the end of one window and `limit` at the start of
 * the next; with the limits used here that burst is still far below what makes
 * brute force viable.
 *
 * Fails OPEN. A limiter that takes the site down when the database hiccups is a
 * worse outage than the abuse it prevents, and every caller of this is also
 * behind the credential check itself.
 */
export async function enforceDurableRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  db: DbClient = prisma,
): Promise<void> {
  await assertDurableRateLimit(key, limit, windowMs, db);
  await recordDurableHit(key, windowMs, db);
}

/**
 * Read-only half: throws if `key` is already at its limit, without consuming.
 *
 * Paired with `recordDurableHit` on the sign-in path, where only *failed*
 * attempts should count. Charging successful sign-ins would lock out everyone
 * behind a shared IP — carrier-grade NAT and campus/office networks put a lot of
 * legitimate mobile users behind one address.
 */
export async function assertDurableRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  db: DbClient = prisma,
): Promise<void> {
  const now = Date.now();
  const window = windowStart(now, windowMs);

  let count: number;
  try {
    const row = await db.rateLimitCounter.findUnique({
      where: { key_window: { key, window } },
      select: { count: true },
    });
    count = row?.count ?? 0;
  } catch {
    return; // fail open — see the note above
  }

  if (count >= limit) {
    const resetsAt = window.getTime() + windowMs;
    throw retryableError("RATE_LIMIT", RATE_LIMIT_MESSAGE, 429, (resetsAt - now) / 1000);
  }
}

/** Consuming half: charges one hit against `key`'s current window. */
export async function recordDurableHit(
  key: string,
  windowMs: number,
  db: DbClient = prisma,
): Promise<void> {
  const now = Date.now();
  const window = windowStart(now, windowMs);

  let count: number;
  try {
    const row = await db.rateLimitCounter.upsert({
      where: { key_window: { key, window } },
      create: { key, window, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    count = row.count;
  } catch {
    return;
  }

  // Opportunistic cleanup, on the way past. Cheap because it's indexed on
  // `window`, and only fires on the first hit of a new bucket.
  if (count === 1) {
    void db.rateLimitCounter
      .deleteMany({ where: { window: { lt: new Date(now - MAX_WINDOW_MS) } } })
      .catch(() => {});
  }
}

// ── client identity ─────────────────────────────────────────────────────────

/**
 * Best-effort client IP, for limiting routes that have no authenticated user.
 *
 * Render terminates TLS at its proxy and appends the real client to
 * `x-forwarded-for`, so the LEFTMOST entry is the client. That entry is
 * client-controllable in principle, which is why it is only ever used as a rate
 * limit key — never for authorization — and why the auth routes pair it with an
 * identifier-keyed limit that a spoofed IP can't dodge.
 */
export function clientIp(request: Request): string {
  return knownClientIp(request) ?? "unknown";
}

/**
 * The client address, or null when no proxy header identifies one.
 *
 * The distinction matters for limiting an *unauthenticated* route. Falling back
 * to a single shared bucket would mean that if the proxy header ever went
 * missing, every caller in the world would contend for one limit — turning a
 * misconfiguration into a self-inflicted outage that is strictly worse than not
 * limiting the route at all. Callers that can't key on a real address should
 * skip the limit rather than lump everyone together.
 *
 * The auth routes deliberately use `clientIp` and accept the lumping: they are
 * low-volume, and over-limiting sign-in attempts is the safe direction to err.
 */
export function knownClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return request.headers.get("x-real-ip")?.trim() || null;
}
