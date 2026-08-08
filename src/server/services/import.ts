import { CaptureKind } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { capturePipeline } from "@/server/services/admission";
import { captureItem } from "@/server/services/cognition";
import { parseImportContent, planImport, type ImportPlan } from "@/server/services/import-parse";

/**
 * Bulk link import: parse → dedupe → run each URL through the ordinary
 * capture pipeline as a background job the client polls.
 *
 * Job state is in-process only (this backend is one long-lived Node process;
 * there is no queue or job table anywhere in the app). A restart mid-import
 * loses the remaining URLs and the status row — the captures already made
 * are durable, and re-importing the same file skips them as duplicates, so
 * the recovery story is "run it again".
 */

export type ImportJobStatus = {
  id: string;
  total: number;
  done: number;
  failed: number;
  duplicates: number;
  invalid: number;
  overCap: number;
  status: "running" | "done";
  startedAt: string;
  finishedAt: string | null;
};

type ImportJob = ImportJobStatus & { userId: string };

// One job per user — the latest sticks around after finishing so a user who
// left mid-import comes back to the final tally rather than to nothing.
const jobsByUser = new Map<string, ImportJob>();

// Import runs beneath the interactive path: two lanes, and every URL still
// passes through the shared capture semaphore so a big import can never
// starve live captures of more than two of the eight slots.
const IMPORT_CONCURRENCY = 2;
const BUSY_RETRY_DELAY_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getImportJob(userId: string): ImportJobStatus | null {
  const job = jobsByUser.get(userId);
  if (!job) return null;
  const { userId: _owner, ...status } = job;
  return status;
}

/** Which of these canonical URLs the user has already captured. Chunked so a
 * giant bookmark file never turns into one giant `IN (...)`. */
async function loadExistingCanonical(
  db: DbClient,
  userId: string,
  candidates: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const rows = await db.capturedItem.findMany({
      where: {
        userId,
        contentItem: { canonicalUrl: { in: candidates.slice(i, i + CHUNK) } },
      },
      select: { contentItem: { select: { canonicalUrl: true } } },
    });
    for (const row of rows) {
      if (row.contentItem?.canonicalUrl) existing.add(row.contentItem.canonicalUrl);
    }
  }
  return existing;
}

async function captureOne(userId: string, url: string): Promise<void> {
  try {
    await capturePipeline.run(() => captureItem({ userId, kind: CaptureKind.LINK, url }));
  } catch (error) {
    // A busy backend is the one failure worth waiting out — the job has
    // nowhere to be. Anything else (dead link, paywall, SSRF refusal) is
    // this URL's problem and just counts as failed.
    if (error instanceof AppError && error.code === "SERVER_BUSY") {
      await sleep(BUSY_RETRY_DELAY_MS);
      await capturePipeline.run(() => captureItem({ userId, kind: CaptureKind.LINK, url }));
      return;
    }
    throw error;
  }
}

async function runImport(job: ImportJob, urls: string[]): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (true) {
      const index = next++;
      if (index >= urls.length) return;
      try {
        await captureOne(job.userId, urls[index]);
        job.done += 1;
      } catch {
        job.failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, () => lane()));
  job.status = "done";
  job.finishedAt = new Date().toISOString();
}

export async function startImport(args: {
  userId: string;
  content: string;
  filename?: string;
  db?: DbClient;
}): Promise<ImportJobStatus> {
  const db = args.db ?? prisma;

  const previous = jobsByUser.get(args.userId);
  if (previous && previous.status === "running") {
    throw new AppError("IMPORT_RUNNING", "An import is already mapping. Let it finish first.", 409);
  }

  const urls = parseImportContent(args.content, args.filename);
  if (urls.length === 0) {
    throw new AppError("IMPORT_EMPTY", "No links found in that. Check the file or the paste.", 422);
  }

  // Reserve the per-user slot BEFORE the first await — two concurrent POSTs
  // (a double-tap racing the client's busy flag) would otherwise both pass
  // the guard above, plan their dedup against the same pre-import state, and
  // capture the same URLs twice. Everything up to here is synchronous.
  const job: ImportJob = {
    id: randomUUID(),
    userId: args.userId,
    total: 0,
    done: 0,
    failed: 0,
    duplicates: 0,
    invalid: 0,
    overCap: 0,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobsByUser.set(args.userId, job);

  let plan: ImportPlan;
  try {
    // Normalize + in-batch dedupe first (empty existing set), then check the
    // DB for just those candidates, then plan for real.
    const candidates = planImport({ urls, existing: new Set(), cap: Number.MAX_SAFE_INTEGER });
    const existing = await loadExistingCanonical(db, args.userId, candidates.toCapture);
    plan = planImport({ urls, existing });
  } catch (error) {
    // Give the slot back — a failed plan must not leave a phantom "running"
    // job blocking every future import. Restore the last finished job so the
    // status endpoint keeps showing the previous tally.
    if (previous) jobsByUser.set(args.userId, previous);
    else jobsByUser.delete(args.userId);
    throw error;
  }

  job.total = plan.toCapture.length;
  job.duplicates = plan.duplicates;
  job.invalid = plan.invalid;
  job.overCap = plan.overCap;

  if (plan.toCapture.length > 0) {
    void runImport(job, plan.toCapture);
  } else {
    job.status = "done";
    job.finishedAt = new Date().toISOString();
  }

  const { userId: _owner, ...status } = job;
  return status;
}
