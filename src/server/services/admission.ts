import { retryableError } from "@/lib/api";

/**
 * Concurrency admission control for the expensive, LLM-backed work.
 *
 * The failure this prevents: the backend is one Node process. Capture fans out
 * to several OpenAI round-trips plus synchronous CPU (SMACOF layout, bcrypt,
 * JSON of multi-megabyte payloads). Without a ceiling, a burst of captures
 * queues unbounded work against one event loop — and the visible symptom is not
 * "captures are slow", it's that *every* request, including cheap ones, stalls
 * behind it. One user's burst becomes everyone's outage.
 *
 * With a ceiling, the burst degrades honestly: a bounded number run at full
 * speed, a few more wait briefly, and the excess gets a clean retryable 503
 * instead of a timeout. Slot counts are set above realistic steady-state
 * concurrency, so ordinary traffic never touches this.
 */

const BUSY_MESSAGE = "We're handling a lot right now — give that another try in a moment.";

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class Semaphore {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(
    readonly name: string,
    /** How many may run at once. */
    private readonly slots: number,
    /** How long a caller may wait for a slot before being turned away. */
    private readonly maxWaitMs: number,
  ) {}

  /**
   * Runs `fn` once a slot is free. Throws a retryable 503 if no slot opens
   * within `maxWaitMs`.
   *
   * The slot is released in a `finally`, so a throwing `fn` can never leak one —
   * a leaked slot is permanent and would slowly strangle the route.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.slots) {
      this.active += 1;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          // Drop out of the queue on timeout. Leaving the entry behind would
          // hand a slot to a caller that has already been answered.
          const index = this.waiting.indexOf(waiter);
          if (index !== -1) this.waiting.splice(index, 1);

          reject(
            retryableError("SERVER_BUSY", BUSY_MESSAGE, 503, this.maxWaitMs / 1000),
          );
        }, this.maxWaitMs),
      };

      this.waiting.push(waiter);
    });
  }

  private release() {
    const next = this.waiting.shift();

    if (next) {
      // Hand the slot straight over — `active` stays as-is because ownership
      // transfers rather than being returned and re-taken.
      clearTimeout(next.timer);
      next.resolve();
      return;
    }

    this.active -= 1;
  }

  /** Test/observability seam. */
  stats() {
    return { active: this.active, waiting: this.waiting.length };
  }
}

/**
 * Slot budgets. Sized against a 0.5-CPU instance talking to OpenAI: the work is
 * mostly network-bound, so the limit is about bounding memory and queue depth
 * rather than saturating CPU.
 */

/** Full capture pipeline: extraction + vision + embed + classify + insights. */
export const capturePipeline = new Semaphore("capture", 8, 10_000);

/** Whisper transcription — large uploads, so the tighter bound is memory. */
export const transcription = new Semaphore("transcribe", 4, 8_000);

/** Companion replies. Interactive, so a short wait beats a long queue. */
export const companionReplies = new Semaphore("companion", 6, 8_000);
