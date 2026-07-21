import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/api";
import { Semaphore } from "./admission";

/** A promise plus the handles to settle it from the test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Semaphore", () => {
  it("runs work immediately while slots are free", async () => {
    const sem = new Semaphore("test", 2, 1_000);
    await expect(sem.run(async () => "done")).resolves.toBe("done");
    expect(sem.stats()).toEqual({ active: 0, waiting: 0 });
  });

  it("holds callers past the slot count, then admits them as slots free", async () => {
    const sem = new Semaphore("test", 1, 1_000);
    const first = deferred();

    const firstRun = sem.run(() => first.promise);
    await Promise.resolve();
    expect(sem.stats()).toEqual({ active: 1, waiting: 0 });

    let secondStarted = false;
    const secondRun = sem.run(async () => {
      secondStarted = true;
    });
    await Promise.resolve();

    expect(secondStarted).toBe(false);
    expect(sem.stats().waiting).toBe(1);

    first.resolve();
    await firstRun;
    await secondRun;

    expect(secondStarted).toBe(true);
    expect(sem.stats()).toEqual({ active: 0, waiting: 0 });
  });

  // A leaked slot is permanent, and would slowly strangle the route it guards.
  it("releases the slot when the work throws", async () => {
    const sem = new Semaphore("test", 1, 1_000);

    await expect(
      sem.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(sem.stats()).toEqual({ active: 0, waiting: 0 });
    await expect(sem.run(async () => "still works")).resolves.toBe("still works");
  });

  it("turns a caller away with a retryable 503 rather than queueing forever", async () => {
    const sem = new Semaphore("test", 1, 20);
    const blocker = deferred();
    const blocking = sem.run(() => blocker.promise);

    const rejected = await sem.run(async () => "never runs").catch((error) => error);

    expect(rejected).toBeInstanceOf(AppError);
    expect((rejected as AppError).status).toBe(503);
    expect((rejected as AppError).code).toBe("SERVER_BUSY");
    expect((rejected as AppError).retryAfterSeconds).toBeGreaterThan(0);

    // The timed-out caller must not still be queued for a slot it will never use.
    expect(sem.stats().waiting).toBe(0);

    blocker.resolve();
    await blocking;
    expect(sem.stats()).toEqual({ active: 0, waiting: 0 });
  });

  it("never exceeds its slot count under a burst", async () => {
    const sem = new Semaphore("test", 3, 1_000);
    let running = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 20 }, () =>
        sem.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 1));
          running -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(sem.stats()).toEqual({ active: 0, waiting: 0 });
  });
});
