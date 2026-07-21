import { MetadataStatus } from "@prisma/client";
import slugify from "slugify";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { fetchMetadata, isPdfContentUrl, scoreContentConfidence, sourceSlug, type ContentConfidence } from "@/server/metadata";
import { cleanContentMetadata } from "@/server/cognition/llm";
import { upsertTopics } from "@/server/topics";
import { assertPublicHttpUrl } from "@/server/ssrf";
import { normalizeUrl } from "@/server/url";

async function ensureContentSource(db: DbClient, name?: string, domain?: string) {
  if (!name && !domain) {
    return null;
  }

  const finalName = name ?? domain ?? "Unknown";
  const slug = sourceSlug(finalName);

  return db.contentSource.upsert({
    where: domain ? { domain } : { slug },
    update: {
      name: finalName,
      domain: domain ?? undefined,
    },
    create: {
      name: finalName,
      slug,
      domain: domain ?? undefined,
    },
  });
}

async function ensureContentType(db: DbClient, type?: string) {
  if (!type) {
    return null;
  }

  const slug = slugify(type, { lower: true, strict: true, trim: true });

  return db.contentType.upsert({
    where: { slug },
    update: { name: type },
    create: {
      name: type,
      slug,
    },
  });
}

async function attachContentTopics(db: DbClient, contentItemId: string, topics: string[]) {
  const topicRecords = await upsertTopics(db, topics);

  await db.contentItemTopic.deleteMany({
    where: { contentItemId },
  });

  if (topicRecords.length === 0) {
    return [] as typeof topicRecords;
  }

  await db.contentItemTopic.createMany({
    data: topicRecords.map((topic) => ({
      contentItemId,
      topicId: topic.id,
    })),
  });

  return topicRecords;
}

export async function serializeContentItem(db: DbClient, id: string) {
  return db.contentItem.findUniqueOrThrow({
    where: { id },
    include: {
      source: true,
      contentType: true,
      topics: {
        include: {
          topic: true,
        },
      },
    },
  });
}

type IngestOpts = {
  allowPaidTranscript?: boolean;
  /** Capture path: don't block on the LLM metadata clean. The ContentItem is
   * created with raw scraped values immediately and `cleaned` resolves once
   * the clean lands (having updated the row), so the caller can overlap it
   * with its own LLM work instead of paying for it serially. */
  deferClean?: boolean;
};

/** Final (post-clean) display metadata, mirroring what the row was updated to. */
export type CleanedContentFields = { title: string; description: string | null };

export async function ingestUrl(url: string, db: DbClient = prisma, opts: IngestOpts = {}) {
  // Before anything else: this is the single point where a user-supplied URL
  // becomes a server-side fetch. Both the fresh-scrape path below and the
  // body-backfill retry on an existing row reach the network, so the check
  // belongs here rather than at either branch.
  await assertPublicHttpUrl(url);

  const normalizedUrl = normalizeUrl(url);
  const existing = await db.contentItem.findUnique({
    where: { canonicalUrl: normalizedUrl },
    include: {
      source: true,
      contentType: true,
      topics: {
        include: { topic: true },
      },
    },
  });

  if (existing) {
    // Backfill missing body text for items captured before the extraction
    // ladder existed (or when the earlier scrape failed). Without this,
    // re-capturing a URL whose first fetch came back empty stays title-only
    // forever. Rate-limited to one attempt per day per item: each retry runs
    // the full ladder (including paid Supadata credits), and a URL that just
    // failed will almost always fail again minutes later.
    const RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
    // PDFs bypass the cooldown: they parse locally (no paid tier to protect),
    // and every PDF captured before the PDF pipeline existed is a thin stub
    // that would otherwise stay broken for a day after the fix shipped.
    const retryDue =
      Date.now() - existing.updatedAt.getTime() > RETRY_COOLDOWN_MS ||
      isPdfContentUrl(existing.canonicalUrl ?? "");
    if (!existing.bodyText && existing.canonicalUrl && retryDue) {
      try {
        const refetched = await fetchMetadata(existing.canonicalUrl, opts);
        const body = refetched.metadata?.bodyText;
        if (body) {
          // A stub row (scrape failed at first capture: hostname-as-title,
          // URL-as-description) adopts the refetched identity too — healing
          // only the body would leave the capture named after its domain.
          const hostTitle = (() => {
            try {
              return new URL(existing.canonicalUrl).hostname.replace(/^www\./, "");
            } catch {
              return undefined;
            }
          })();
          const isStubTitle = Boolean(refetched.metadata?.title) &&
            (existing.title === hostTitle || existing.title === "Link");
          const isStubDescription = !existing.description || /^https?:\/\//i.test(existing.description);
          await db.contentItem.update({
            where: { id: existing.id },
            data: {
              bodyText: body,
              bodySource: refetched.metadata?.bodySource,
              ...(isStubTitle ? { title: refetched.metadata!.title } : {}),
              // Never let description become the full body/transcript — it is
              // surfaced as a short gist. Leave it null if we have no real
              // excerpt; the capture pipeline derives its own summary.
              ...(isStubDescription ? { description: refetched.metadata?.description ?? null } : {}),
            },
          });
          existing.bodyText = body;
          existing.bodySource = refetched.metadata?.bodySource ?? null;
          if (isStubTitle) existing.title = refetched.metadata!.title!;
          if (isStubDescription) existing.description = refetched.metadata?.description ?? null;
        } else {
          // Failed again: touch updatedAt so the cooldown restarts — otherwise
          // a permanently thin URL would retry the paid ladder on every capture.
          await db.contentItem.update({
            where: { id: existing.id },
            data: { updatedAt: new Date() },
          });
        }
      } catch {
        // best-effort; fall through with whatever we have
      }
    }

    return {
      status: "existing" as const,
      requiresManualInput: false,
      contentItem: existing,
    };
  }

  let fetched: Awaited<ReturnType<typeof fetchMetadata>>;

  try {
    fetched = await fetchMetadata(url, opts);
  } catch {
    return {
      status: "manual_required" as const,
      requiresManualInput: true,
      normalizedUrl,
    };
  }

  if (!fetched.metadata || fetched.requiresManualInput || !fetched.metadata.title || !fetched.metadata.canonicalUrl) {
    return {
      status: "manual_required" as const,
      requiresManualInput: true,
      normalizedUrl,
      metadata: fetched.metadata,
    };
  }

  const metadata = fetched.metadata;

  // One structured line per extraction so proxy success rate and Supadata
  // credit burn are visible in production (Render) logs.
  console.log(
    JSON.stringify({
      event: "extraction",
      domain: metadata.sourceDomain,
      bodySource: metadata.bodySource ?? null,
      confidence: scoreContentConfidence(metadata),
      usedProxy: metadata.usedProxy ?? false,
      usedSupadata: metadata.usedSupadata ?? false,
    }),
  );

  const canonicalUrl = metadata.canonicalUrl!;
  const source = await ensureContentSource(db, metadata.sourceName, metadata.sourceDomain);
  const contentType = await ensureContentType(db, metadata.contentType);

  let created;
  try {
    created = await db.contentItem.create({
      data: {
        title: metadata.title!,
        description: metadata.description,
        bodyText: metadata.bodyText,
        bodySource: metadata.bodySource,
        canonicalUrl,
        originalUrl: metadata.originalUrl,
        siteName: metadata.siteName,
        imageUrl: metadata.imageUrl,
        authorName: metadata.authorName,
        publishedAt: metadata.publishedAt,
        metadataStatus: MetadataStatus.COMPLETE,
        sourceId: source?.id,
        contentTypeId: contentType?.id,
        manualFields: undefined,
      },
    });
  } catch (err: unknown) {
    // The pre-check above compares against the raw input URL, but this
    // insert is keyed on the page's own declared canonical URL (og:url /
    // link[rel=canonical]), which can differ (AMP variants, redirects,
    // extra query params the site itself drops). When another request
    // already created that row first, fall back to it instead of failing.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      const existingByCanonical = await db.contentItem.findUnique({ where: { canonicalUrl } });
      if (existingByCanonical) {
        return {
          status: "existing" as const,
          requiresManualInput: false,
          contentItem: await serializeContentItem(db, existingByCanonical.id),
        };
      }
    }
    throw err;
  }

  // Clean scraped metadata: separate author from title, drop boilerplate, and
  // produce a meaningful excerpt. Falls back to raw values on any failure. The
  // row is created with raw values above and updated when the clean lands, so
  // a deferClean caller can overlap this LLM call with its own instead of
  // paying for it serially — the capture path's biggest single saving.
  const cleaned: Promise<CleanedContentFields | null> = cleanContentMetadata({
    rawTitle: metadata.title!,
    rawDescription: metadata.description,
    rawAuthor: metadata.authorName,
    siteName: metadata.siteName,
    bodyText: metadata.bodyText,
  })
    .then(async (clean) => {
      if (!clean) return null;
      const title = clean.title ?? metadata.title!;
      const description = clean.excerpt ?? metadata.description ?? null;
      const authorName = clean.author ?? metadata.authorName;
      await db.contentItem.update({
        where: { id: created.id },
        data: { title, description, authorName },
      });
      return { title, description };
    })
    .catch(() => null);

  if (!opts.deferClean) {
    await cleaned;
    return {
      status: "created" as const,
      requiresManualInput: false,
      contentItem: await serializeContentItem(db, created.id),
      bodyText: metadata.bodyText,
    };
  }

  return {
    status: "created" as const,
    requiresManualInput: false,
    contentItem: await serializeContentItem(db, created.id),
    bodyText: metadata.bodyText,
    cleaned,
  };
}

/**
 * Capture-time preflight: resolves what we can extract from a URL so the
 * capture sheet can tell the user whether the content was actually readable —
 * and ask them what it was about when it wasn't. Creates/refreshes the
 * ContentItem, which the subsequent capture reuses via canonicalUrl dedupe.
 */
export async function preflightUrl(url: string, db: DbClient = prisma, opts: IngestOpts = {}): Promise<{
  confidence: ContentConfidence;
  title?: string;
  excerpt?: string;
  bodySource?: string;
}> {
  let ingest: Awaited<ReturnType<typeof ingestUrl>>;
  try {
    ingest = await ingestUrl(url, db, opts);
  } catch {
    return { confidence: "thin" };
  }

  if ("contentItem" in ingest && ingest.contentItem) {
    const item = ingest.contentItem;
    return {
      confidence: scoreContentConfidence({ bodyText: item.bodyText, description: item.description }),
      title: item.title,
      excerpt: item.description ?? undefined,
      bodySource: item.bodySource ?? undefined,
    };
  }

  const partial = "metadata" in ingest ? ingest.metadata : undefined;
  return {
    confidence: scoreContentConfidence({ bodyText: partial?.bodyText, description: partial?.description }),
    title: partial?.title,
    excerpt: partial?.description,
    bodySource: partial?.bodySource,
  };
}

/**
 * Resolves a URL to a ContentItem when possible; if metadata fetch fails,
 * creates a minimal manual item so capture stays one-tap.
 */
export async function ingestOrStubUrl(url: string, db: DbClient = prisma, opts: IngestOpts = {}) {
  const ingest = await ingestUrl(url, db, opts);

  if ("contentItem" in ingest && ingest.contentItem && !ingest.requiresManualInput) {
    const row = ingest.contentItem;
    return {
      contentItemId: row.id,
      contentTitle: row.title,
      contentDescription: row.description ?? undefined,
      bodyText: row.bodyText ?? undefined,
      // Present only when this call created the row with deferClean: resolves
      // with the post-clean title/excerpt once the row has been updated.
      cleaned: "cleaned" in ingest ? ingest.cleaned : undefined,
    };
  }

  const normalizedUrl = normalizeUrl(url);
  let title = "Link";

  try {
    const parsed = new URL(normalizedUrl);
    title = parsed.hostname.replace(/^www\./, "") || "Link";
  } catch {
    // keep generic title
  }

  const created = await createManualContentItem(
    {
      title,
      description: normalizedUrl,
      canonicalUrl: normalizedUrl,
      originalUrl: normalizedUrl,
      topics: [],
    },
    db,
  );

  return {
    contentItemId: created.id,
    contentTitle: created.title,
    contentDescription: created.description ?? normalizedUrl,
  };
}

export async function createManualContentItem(input: {
  title: string;
  description?: string;
  canonicalUrl?: string;
  originalUrl?: string;
  siteName?: string;
  imageUrl?: string;
  authorName?: string;
  publishedAt?: string;
  sourceName?: string;
  sourceDomain?: string;
  contentType?: string;
  topics: string[];
}, db: DbClient = prisma) {
  const canonicalUrl = input.canonicalUrl ? normalizeUrl(input.canonicalUrl) : undefined;
  const originalUrl = input.originalUrl ? normalizeUrl(input.originalUrl) : undefined;

  if (canonicalUrl) {
    const existing = await db.contentItem.findUnique({
      where: { canonicalUrl },
    });

    if (existing) {
      return serializeContentItem(db, existing.id);
    }
  }

  const source = await ensureContentSource(db, input.sourceName ?? input.siteName, input.sourceDomain);
  const contentType = await ensureContentType(db, input.contentType);

  let created;
  try {
    created = await db.contentItem.create({
      data: {
        title: input.title,
        description: input.description,
        canonicalUrl,
        originalUrl,
        siteName: input.siteName,
        imageUrl: input.imageUrl,
        authorName: input.authorName,
        publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
        metadataStatus: canonicalUrl || originalUrl ? MetadataStatus.COMPLETE : MetadataStatus.MANUAL_ONLY,
        sourceId: source?.id,
        contentTypeId: contentType?.id,
        manualFields: {
          title: input.title,
          description: input.description,
        },
      },
    });
  } catch (err: unknown) {
    // The pre-check above can miss a concurrent insert of the same canonical
    // URL (e.g. capture's preflight and commit racing). Fall back to the
    // existing row instead of surfacing a duplicate-key error to the user.
    if (
      canonicalUrl &&
      err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002"
    ) {
      const existingByCanonical = await db.contentItem.findUnique({ where: { canonicalUrl } });
      if (existingByCanonical) {
        return serializeContentItem(db, existingByCanonical.id);
      }
    }
    throw err;
  }

  await attachContentTopics(db, created.id, input.topics);

  return serializeContentItem(db, created.id);
}

export async function requireContentItem(contentItemId: string, db: DbClient = prisma) {
  const contentItem = await db.contentItem.findUnique({
    where: { id: contentItemId },
  });

  if (!contentItem) {
    throw new AppError("CONTENT_NOT_FOUND", "Content item not found", 404);
  }

  return contentItem;
}

export async function updateContentTopics(contentItemId: string, topics: string[], db: DbClient = prisma) {
  await requireContentItem(contentItemId, db);
  await attachContentTopics(db, contentItemId, topics);
  return serializeContentItem(db, contentItemId);
}
