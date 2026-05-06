import { MetadataStatus } from "@prisma/client";
import slugify from "slugify";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { fetchMetadata, sourceSlug } from "@/server/metadata";
import { upsertTopics } from "@/server/topics";
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

export async function ingestUrl(url: string, db: DbClient = prisma) {
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
    return {
      status: "existing" as const,
      requiresManualInput: false,
      contentItem: existing,
    };
  }

  let fetched: Awaited<ReturnType<typeof fetchMetadata>>;

  try {
    fetched = await fetchMetadata(url);
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
  const title = metadata.title!;
  const canonicalUrl = metadata.canonicalUrl!;
  const source = await ensureContentSource(db, metadata.sourceName, metadata.sourceDomain);
  const contentType = await ensureContentType(db, metadata.contentType);

  const created = await db.contentItem.create({
    data: {
      title,
      description: metadata.description,
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

  return {
    status: "created" as const,
    requiresManualInput: false,
    contentItem: await serializeContentItem(db, created.id),
  };
}

/**
 * Resolves a URL to a ContentItem when possible; if metadata fetch fails,
 * creates a minimal manual item so capture stays one-tap.
 */
export async function ingestOrStubUrl(url: string, db: DbClient = prisma) {
  const ingest = await ingestUrl(url, db);

  if ("contentItem" in ingest && ingest.contentItem && !ingest.requiresManualInput) {
    const row = ingest.contentItem;
    return {
      contentItemId: row.id,
      contentTitle: row.title,
      contentDescription: row.description ?? undefined,
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

  const created = await db.contentItem.create({
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
