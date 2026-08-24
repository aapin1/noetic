import { CaptureKind } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { ProviderItem } from "@/server/connections/types";
import type { DbClient } from "@/server/db";
import { resolveWork } from "@/server/imports/resolve";
import { capturePipeline } from "@/server/services/admission";
import { captureItem } from "@/server/services/cognition";
import { createManualContentItem } from "@/server/services/content";

/**
 * One provider item → one capture. Shared by connected accounts and file
 * imports, so a Goodreads review arrives on the map the same way whether it
 * came from the RSS feed or the CSV.
 *
 * Three shapes, chosen by `item.mode`:
 *  - "link"  — a kept page: the ordinary link pipeline reads it (article body,
 *              captions), with any note as the reaction.
 *  - "text"  — the person's own writing: a TEXT capture, url kept as source.
 *  - "words" — a review/note about a work: a LINK (or QUOTE when highlights
 *              are present) on a content item built from the feed, never
 *              scraped; reaction = rating line + words.
 */

const BUSY_RETRY_DELAY_MS = 15_000;

export type CaptureSite = { siteName: string; contentType: string };

/**
 * Feeds that name a work but ship no blurb (a Letterboxd film, a Steam game —
 * their pages turn scrapers away). The keyless work resolver can still find a
 * synopsis, so the capture knows what the work IS, not just what the person
 * said about it.
 */
const RESOLVE_KIND: Record<string, NonNullable<ProviderItem["lookup"]>["kind"]> = {
  film: "film",
  tv: "tv",
  book: "book",
  anime: "anime",
  game: "game",
  music: "album",
};

function workLookup(item: ProviderItem, contentType: string): NonNullable<ProviderItem["lookup"]> | null {
  if (item.lookup) return item.lookup;
  const kind = RESOLVE_KIND[contentType];
  if (!kind) return null;
  const m = item.title.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return { kind, title: m ? m[1] : item.title, year: m ? Number(m[2]) : undefined, author: item.author };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await capturePipeline.run(fn);
  } catch (error) {
    if (error instanceof AppError && error.code === "SERVER_BUSY") {
      await sleep(BUSY_RETRY_DELAY_MS);
      return capturePipeline.run(fn);
    }
    throw error;
  }
}

export async function captureProviderItem(args: {
  userId: string;
  /** "letterboxd", "import:goodreads-csv" — lands on CapturedItem.origin. */
  origin: string;
  site: CaptureSite;
  item: ProviderItem;
  now?: Date;
  db?: DbClient;
}): Promise<string> {
  const { userId, origin, item } = args;
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const occurred = item.occurredAt.getTime();
  const capturedAt = Number.isFinite(occurred) && occurred < now.getTime() ? item.occurredAt : now;

  if (item.mode === "link") {
    const id = await runWithRetry(() =>
      captureItem({ userId, kind: CaptureKind.LINK, url: item.url, reaction: item.words || undefined, origin, capturedAt }),
    );
    return id.id;
  }

  // A review with no context about its work reads as words about a bare
  // title. Resolve the work once (cached) and let its synopsis become the
  // content: the About section, topics, and grounding all inherit it. A miss
  // changes nothing — the capture proceeds exactly as before.
  if ((item.mode ?? "words") === "words" && !item.description) {
    const lookup = workLookup(item, args.site.contentType);
    if (lookup) {
      const found = await resolveWork(lookup);
      if (found) {
        item.description = found.description;
        item.imageUrl = item.imageUrl ?? found.imageUrl;
        item.author = item.author ?? found.author;
      }
    }
  }

  let siteName = args.site.siteName;
  if (item.url && /^https?:\/\//.test(item.url) && args.site.siteName === "Readwise") {
    try {
      siteName = new URL(item.url).hostname.replace(/^www\./, "") || siteName;
    } catch {
      /* keep */
    }
  }
  const hasUrl = /^https?:\/\//i.test(item.url);
  const content = await createManualContentItem(
    {
      title: item.title,
      description: item.description,
      canonicalUrl: hasUrl ? item.url : undefined,
      originalUrl: hasUrl ? item.url : undefined,
      siteName,
      imageUrl: item.imageUrl,
      authorName: item.author,
      contentType: args.site.contentType,
      topics: [],
    },
    db,
  );

  const payload =
    item.mode === "text"
      ? { kind: CaptureKind.TEXT, text: item.words }
      : item.quote !== undefined
        ? { kind: CaptureKind.QUOTE, text: item.quote || item.words, reaction: item.words || undefined }
        : { kind: CaptureKind.LINK, reaction: [item.rating, item.words].filter(Boolean).join("\n\n") };

  const created = await runWithRetry(() =>
    captureItem({
      userId,
      url: hasUrl ? item.url : undefined,
      contentItemId: content.id,
      origin,
      capturedAt,
      ...payload,
    }),
  );
  return created.id;
}
