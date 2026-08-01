import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "@/server/db";
import { acquireLease, LEASE_TTL_MS, releaseLease, withLease } from "@/server/services/jobs";

/**
 * The lease is what makes an hourly cron safe to overlap. Every job under it is
 * idempotent, but idempotency cannot un-send a push already in flight — so two
 * concurrent runs must not both reach the drain.
 */

const NOW = new Date("2026-07-30T12:00:00Z");

type Row = { name: string; heldUntil: Date; heldBy: string };

/**
 * Stands in for Postgres, including the part that matters: the conditional
 * UPDATE and the primary-key INSERT are each atomic, so exactly one of N racing
 * callers can win.
 */
function fakeDb(rows: Row[] = []) {
  const db = {
    jobLease: {
      updateMany: async (args: {
        where: { name: string; heldUntil?: { lte: Date }; heldBy?: string };
        data: Partial<Row>;
      }) => {
        const row = rows.find((r) => r.name === args.where.name);
        if (!row) return { count: 0 };
        if (args.where.heldUntil && row.heldUntil > args.where.heldUntil.lte) return { count: 0 };
        if (args.where.heldBy !== undefined && row.heldBy !== args.where.heldBy) return { count: 0 };
        Object.assign(row, args.data);
        return { count: 1 };
      },
      create: async (args: { data: Row }) => {
        if (rows.some((r) => r.name === args.data.name)) {
          throw new Error("unique constraint violation");
        }
        rows.push({ ...args.data });
        return args.data;
      },
    },
  } as unknown as DbClient;

  return { db, rows };
}

describe("acquireLease", () => {
  it("creates the lease on a job's first ever run", async () => {
    const { db, rows } = fakeDb();

    expect(await acquireLease("job", db, NOW)).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0].heldUntil.getTime()).toBe(NOW.getTime() + LEASE_TTL_MS);
  });

  it("refuses a second holder while the first is live", async () => {
    const { db } = fakeDb();

    expect(await acquireLease("job", db, NOW)).not.toBeNull();
    expect(await acquireLease("job", db, NOW)).toBeNull();
  });

  it("gives exactly one winner when many runs race the first execution", async () => {
    const { db } = fakeDb();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => acquireLease("job", db, NOW)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("lets the next hour take over a lease a crashed run never released", async () => {
    // The reason the claim has an expiry at all: without it, one run dying mid
    // flight would wedge the job until somebody noticed by hand.
    const { db } = fakeDb();
    expect(await acquireLease("job", db, NOW)).not.toBeNull();

    const nextHour = new Date(NOW.getTime() + 60 * 60 * 1000);
    expect(await acquireLease("job", db, nextHour)).not.toBeNull();
  });

  it("expires before the next hourly tick, so a dead run costs one hour and no more", () => {
    expect(LEASE_TTL_MS).toBeLessThan(60 * 60 * 1000);
  });

  it("treats a database it cannot read as held, rather than sending twice", async () => {
    const brokenDb = {
      jobLease: {
        updateMany: async () => {
          throw new Error("connection refused");
        },
      },
    } as unknown as DbClient;

    expect(await acquireLease("job", brokenDb, NOW)).toBeNull();
  });
});

describe("releaseLease", () => {
  it("frees the lease so a later run in the same hour is not locked out", async () => {
    const { db } = fakeDb();
    const lease = await acquireLease("job", db, NOW);
    expect(lease).not.toBeNull();

    await releaseLease(lease!, db);

    expect(await acquireLease("job", db, NOW)).not.toBeNull();
  });

  it("cannot release a claim that has already been taken over", async () => {
    // A run that overran its lease must not be able to free the successor that
    // replaced it — that is how you get two live holders at once.
    const { db } = fakeDb();
    const overran = await acquireLease("job", db, NOW);
    const nextHour = new Date(NOW.getTime() + 60 * 60 * 1000);
    const successor = await acquireLease("job", db, nextHour);
    expect(successor).not.toBeNull();

    await releaseLease(overran!, db);

    expect(await acquireLease("job", db, nextHour)).toBeNull();
  });
});

describe("withLease", () => {
  it("runs the work and reports the result", async () => {
    const { db } = fakeDb();
    const outcome = await withLease("job", async () => 42, db, NOW);

    expect(outcome).toEqual({ ran: true, result: 42 });
  });

  it("skips the work entirely when another run holds the lease", async () => {
    const { db } = fakeDb();
    await acquireLease("job", db, NOW);

    const work = vi.fn(async () => "done");
    const outcome = await withLease("job", work, db, NOW);

    expect(work).not.toHaveBeenCalled();
    expect(outcome.ran).toBe(false);
  });

  it("releases even when the work throws, so a failure costs no extra hour", async () => {
    const { db } = fakeDb();

    await expect(
      withLease("job", async () => {
        throw new Error("boom");
      }, db, NOW),
    ).rejects.toThrow("boom");

    expect(await acquireLease("job", db, NOW)).not.toBeNull();
  });
});
