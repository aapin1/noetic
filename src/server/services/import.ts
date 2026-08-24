import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { ProviderItem } from "@/server/connections/types";
import type { DbClient } from "@/server/db";
import { parseImportFile, type ImportParse } from "@/server/imports";
import { resolveWork } from "@/server/imports/resolve";
import { captureProviderItem } from "@/server/services/capture-items";
import { IMPORT_CAP } from "@/server/services/import-parse";
import { normalizeUrl } from "@/server/url";

/**
 * File import: any export a person can get their hands on — a Goodreads CSV,
 * a Letterboxd zip, Kindle clippings, a Takeout, an Obsidian vault, a pasted
 * list of links — parsed into provider items and run through the same capture
 * builder the connected accounts use.
 *
 * Two kinds of row: ones with the person's words (always mapped) and bare
 * ones (a watch, a rating). Bare rows come over only when asked
 * (`includeBare`), and only once the work resolver finds a page to read.
 *
 * Job state is in-process only (one long-lived Node process; no queue). A
 * restart mid-import loses the remaining rows and the tally — captures made
 * so far are durable, and re-importing skips them as duplicates.
 */

export type ImportJobStatus = {
  id: string;
  /** Rows queued for capture (after dedupe and the cap). */
  total: number;
  done: number;
  failed: number;
  duplicates: number;
  invalid: number;
  overCap: number;
  /** Bare rows the resolver could not find a page for. */
  unresolved: number;
  /** "goodreads export", "kindle clippings", … */
  formats: string[];
  status: "running" | "done";
  startedAt: string;
  finishedAt: string | null;
};

export type ImportInspect = {
  formats: string[];
  /** Rows seen in the file. */
  seen: number;
  /** Rows carrying the person's words. */
  withWords: number;
  /** Rows that are only a title/link — brought over when asked. */
  bare: number;
  skippedFiles: number;
};

type ImportJob = ImportJobStatus & { userId: string };

const jobsByUser = new Map<string, ImportJob>();
const IMPORT_CONCURRENCY = 2;
/** Catalogue sites whose pages the extractor can't read — worth a resolver pass before falling back to the link itself. */
const UNREADABLE = /(^|\.)(imdb\.com|goodreads\.com|letterboxd\.com|myanimelist\.net|netflix\.com|crunchyroll\.com|grouvee\.com|amazon\.[a-z.]+)\//i;

export function getImportJob(userId: string): ImportJobStatus | null {
  const job = jobsByUser.get(userId);
  if (!job) return null;
  const { userId: _owner, ...status } = job;
  return status;
}

export type ImportInput = { content: string; filename?: string; encoding?: "base64" | "utf8" };

function toParse(input: ImportInput): ImportParse {
  if (input.encoding === "base64") {
    return parseImportFile({ bytes: new Uint8Array(Buffer.from(input.content, "base64")), filename: input.filename });
  }
  return parseImportFile({ text: input.content, filename: input.filename });
}

function isBare(item: ProviderItem): boolean {
  return !item.words && !item.quote && item.mode !== "link" && item.mode !== "text";
}

/** What's in the file, before anything is mapped. The screen shows this and asks the one question. */
export function inspectImport(input: ImportInput): ImportInspect {
  const parsed = toParse(input);
  const bare = parsed.items.filter(isBare).length;
  return { formats: parsed.formats, seen: parsed.seen, withWords: parsed.items.length - bare, bare, skippedFiles: parsed.skippedFiles };
}

async function loadExistingCanonical(db: DbClient, userId: string, candidates: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const chunk = candidates.slice(i, i + CHUNK);
    const rows = await db.capturedItem.findMany({
      where: { userId, contentItem: { canonicalUrl: { in: chunk } } },
      select: { contentItem: { select: { canonicalUrl: true } } },
    });
    for (const r of rows) if (r.contentItem?.canonicalUrl) found.add(r.contentItem.canonicalUrl);
  }
  return found;
}

function canonical(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

async function runImport(job: ImportJob, items: ProviderItem[], db: DbClient): Promise<void> {
  const now = new Date();
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        // A bare row needs a page worth reading. Catalogue pages (imdb,
        // goodreads, letterboxd…) don't extract, so the resolver goes first
        // and the catalogue link is only the fallback for words rows.
        const bare = isBare(item);
        if (item.lookup && (!item.url || (bare && UNREADABLE.test(item.url)))) {
          const found = await resolveWork(item.lookup);
          if (found) {
            item.url = found.url;
            item.description = item.description ?? found.description;
            item.imageUrl = item.imageUrl ?? found.imageUrl;
            item.author = item.author ?? found.author;
          } else if (bare) {
            job.unresolved += 1;
            continue;
          }
        }
        if (bare) item.mode = "link";
        await captureProviderItem({ userId: job.userId, origin: "import", site: { siteName: item.lookup ? "" : "Import", contentType: item.lookup?.kind ?? "article" }, item, now, db });
        job.done += 1;
      } catch (error) {
        job.failed += 1;
        console.error(JSON.stringify({ event: "import_item_failed", title: item.title, url: item.url, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  };
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, () => lane()));
  job.status = "done";
  job.finishedAt = new Date().toISOString();
}

export async function startImport(args: ImportInput & { userId: string; includeBare?: boolean; db?: DbClient }): Promise<ImportJobStatus> {
  const db = args.db ?? prisma;
  const previous = jobsByUser.get(args.userId);
  if (previous && previous.status === "running") {
    throw new AppError("IMPORT_RUNNING", "An import is already mapping. Let it finish first.", 409);
  }

  const parsed = toParse(args);
  if (parsed.items.length === 0) {
    throw new AppError("IMPORT_EMPTY", "Nothing mneme could read in that. Check the file or the paste.", 422);
  }

  // Reserve the per-user slot before the first await: a double-tap would
  // otherwise plan twice against the same pre-import state.
  const job: ImportJob = {
    id: randomUUID(),
    userId: args.userId,
    total: 0,
    done: 0,
    failed: 0,
    duplicates: 0,
    invalid: 0,
    overCap: 0,
    unresolved: 0,
    formats: parsed.formats,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobsByUser.set(args.userId, job);

  let queue: ProviderItem[];
  try {
    const wanted = parsed.items.filter((i) => args.includeBare || !isBare(i));
    const withUrl = wanted.map((i) => ({ item: i, canon: i.url ? canonical(i.url) : null }));
    job.invalid = withUrl.filter((w) => w.item.url && !w.canon).length;
    const existing = await loadExistingCanonical(db, args.userId, withUrl.map((w) => w.canon).filter((c): c is string => !!c));
    const seen = new Set<string>();
    queue = [];
    for (const w of withUrl) {
      if (w.item.url && !w.canon) continue;
      if (w.canon) {
        if (seen.has(w.canon) || existing.has(w.canon)) {
          job.duplicates += 1;
          continue;
        }
        seen.add(w.canon);
        w.item.url = w.canon;
      }
      if (queue.length >= IMPORT_CAP) {
        job.overCap += 1;
        continue;
      }
      queue.push(w.item);
    }
  } catch (error) {
    if (previous) jobsByUser.set(args.userId, previous);
    else jobsByUser.delete(args.userId);
    throw error;
  }

  job.total = queue.length;
  if (queue.length > 0) {
    void runImport(job, queue, db);
  } else {
    job.status = "done";
    job.finishedAt = new Date().toISOString();
  }
  const { userId: _owner, ...status } = job;
  return status;
}
