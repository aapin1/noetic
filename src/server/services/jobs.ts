import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";

/**
 * Mutual exclusion for scheduled jobs, held in Postgres.
 *
 * Postgres advisory locks would be the obvious tool and are the wrong one here:
 * the app talks to Neon through a transaction-mode pooler, where a session-level
 * lock belongs to a connection that gets handed to somebody else the moment the
 * statement ends. A row with an expiry survives pooling, survives a restart, and
 * is inspectable with a SELECT when something looks stuck.
 *
 * The lease is deliberately not a correctness requirement for the work it
 * guards — every job under it is independently idempotent. It exists to stop
 * two concurrent runs doing the same outbound work twice, which idempotency
 * alone cannot prevent once a message is in flight.
 */

/**
 * How long a claim survives without being released.
 *
 * Under an hourly schedule this must be shorter than the interval, or a run
 * that dies without releasing would also block its successor and the job would
 * stay dead until someone noticed. 50 minutes leaves a run the better part of
 * an hour and still frees the lease before the next tick.
 */
export const LEASE_TTL_MS = 50 * 60 * 1000;

export type Lease = {
  name: string;
  /** Opaque holder id. Required to release; a run that overran cannot steal. */
  token: string;
};

function newToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Try to claim `name`. Returns the lease, or null if someone else holds it.
 *
 * Both paths are single statements that Postgres serialises for us:
 *  - the UPDATE only matches a lease that has lapsed, so exactly one of N
 *    racing runs can flip it;
 *  - the INSERT only runs when no row exists at all, and the primary key means
 *    exactly one of N racing first-runs survives.
 *
 * Never throws. A lease we could not read is treated as held — skipping an hour
 * is a far cheaper failure than sending everyone their pushes twice.
 */
export async function acquireLease(
  name: string,
  db: DbClient = prisma,
  now: Date = new Date(),
  ttlMs: number = LEASE_TTL_MS,
): Promise<Lease | null> {
  const token = newToken();
  const heldUntil = new Date(now.getTime() + ttlMs);

  try {
    const { count } = await db.jobLease.updateMany({
      where: { name, heldUntil: { lte: now } },
      data: { heldUntil, heldBy: token },
    });
    if (count > 0) return { name, token };
  } catch {
    return null;
  }

  // No row matched: either the lease is genuinely held, or this job has never
  // run. Only the second case can succeed here.
  try {
    await db.jobLease.create({ data: { name, heldUntil, heldBy: token } });
    return { name, token };
  } catch {
    return null;
  }
}

/**
 * Release a lease we hold, so a follow-up run in the same hour isn't locked out
 * for the full TTL.
 *
 * Scoped to `heldBy` on purpose: if this run overran its lease and another has
 * already claimed it, this must be a no-op rather than a release of somebody
 * else's claim.
 */
export async function releaseLease(lease: Lease, db: DbClient = prisma): Promise<void> {
  try {
    await db.jobLease.updateMany({
      where: { name: lease.name, heldBy: lease.token },
      // Epoch, not `now`: a lease in the past is free, and this avoids a second
      // read to prove it.
      data: { heldUntil: new Date(0) },
    });
  } catch {
    // The TTL is the backstop. A release that failed costs at most one skipped
    // run, which is exactly what the TTL exists to bound.
  }
}

/**
 * Run `fn` under a lease, or skip it entirely if another run holds one.
 *
 * The lease is released whatever happens, so a thrown job does not cost its
 * successor an hour.
 */
export async function withLease<T>(
  name: string,
  fn: () => Promise<T>,
  db: DbClient = prisma,
  now: Date = new Date(),
): Promise<{ ran: true; result: T } | { ran: false; result?: undefined }> {
  const lease = await acquireLease(name, db, now);
  if (!lease) return { ran: false };

  try {
    return { ran: true, result: await fn() };
  } finally {
    await releaseLease(lease, db);
  }
}
