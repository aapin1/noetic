import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import { withLeadInsight, type CaptureListItem } from "@/server/services/cognition";

const UNCATEGORIZED_ID = "uncategorized";

export type ArchiveFolderKind = "general" | "specific" | "uncategorized";

export type ArchiveFolderSummary = {
  topicId: string;
  name: string;
  slug: string;
  kind: ArchiveFolderKind;
  count: number;
  latestActivity: string;
};

export type ArchiveFolderDetail = {
  topicId: string;
  name: string;
  kind: ArchiveFolderKind;
  subfolders: ArchiveFolderSummary[];
  entries: CaptureListItem[];
};

type FolderAgg = {
  topicId: string;
  name: string;
  slug: string;
  kind: ArchiveFolderKind;
  itemIds: Set<string>;
  latestActivity: Date;
};

const CAPTURE_DETAIL_INCLUDE = {
  contentItem: { include: { source: true, contentType: true } },
  topics: { include: { topic: true } },
  insights: { orderBy: { strength: "desc" as const }, take: 1 },
};

function touchFolder(
  folders: Map<string, FolderAgg>,
  key: { topicId: string; name: string; slug: string; kind: ArchiveFolderKind },
  itemId: string,
  capturedAt: Date,
) {
  let folder = folders.get(key.topicId);
  if (!folder) {
    folder = {
      topicId: key.topicId,
      name: key.name,
      slug: key.slug,
      kind: key.kind,
      itemIds: new Set(),
      latestActivity: capturedAt,
    };
    folders.set(key.topicId, folder);
  }
  folder.itemIds.add(itemId);
  if (capturedAt > folder.latestActivity) folder.latestActivity = capturedAt;
}

function toSummary(folder: FolderAgg): ArchiveFolderSummary {
  return {
    topicId: folder.topicId,
    name: folder.name,
    slug: folder.slug,
    kind: folder.kind,
    count: folder.itemIds.size,
    latestActivity: folder.latestActivity.toISOString(),
  };
}

/** Top-level folders: one per general topic the user has any entries under, plus
 * a fallback folder per specific topic for entries with no general topic at all,
 * plus a single "Uncategorized" bucket for entries with no topics whatsoever. */
export async function listArchiveFolders(args: { userId: string; db?: DbClient }): Promise<ArchiveFolderSummary[]> {
  const db = args.db ?? prisma;
  const items = await db.capturedItem.findMany({
    where: { userId: args.userId },
    select: {
      id: true,
      capturedAt: true,
      topics: { select: { topic: { select: { id: true, name: true, slug: true } } } },
    },
  });

  const folders = new Map<string, FolderAgg>();
  let uncategorizedCount = 0;
  let uncategorizedLatest: Date | null = null;

  for (const item of items) {
    const generalRows = item.topics.filter((row) => isGeneralTopic(row.topic.name));
    const specificRows = item.topics.filter((row) => !isGeneralTopic(row.topic.name));

    if (generalRows.length > 0) {
      for (const row of generalRows) {
        touchFolder(
          folders,
          { topicId: row.topic.id, name: row.topic.name, slug: row.topic.slug, kind: "general" },
          item.id,
          item.capturedAt,
        );
      }
    } else if (specificRows.length > 0) {
      for (const row of specificRows) {
        touchFolder(
          folders,
          { topicId: row.topic.id, name: row.topic.name, slug: row.topic.slug, kind: "specific" },
          item.id,
          item.capturedAt,
        );
      }
    } else {
      uncategorizedCount += 1;
      if (!uncategorizedLatest || item.capturedAt > uncategorizedLatest) uncategorizedLatest = item.capturedAt;
    }
  }

  const result = Array.from(folders.values()).map(toSummary);

  if (uncategorizedCount > 0 && uncategorizedLatest) {
    result.push({
      topicId: UNCATEGORIZED_ID,
      name: "Uncategorized",
      slug: UNCATEGORIZED_ID,
      kind: "uncategorized",
      count: uncategorizedCount,
      latestActivity: uncategorizedLatest.toISOString(),
    });
  }

  return result;
}

/** A single folder's contents. For a general topic this includes sub-folders
 * (its co-occurring specific topics) and direct entries (general-tagged items
 * with no specific topic). For a specific topic or the uncategorized bucket,
 * it's a leaf: no sub-folders, just entries. */
export async function getArchiveFolder(args: {
  userId: string;
  topicId: string;
  db?: DbClient;
}): Promise<ArchiveFolderDetail> {
  const db = args.db ?? prisma;

  if (args.topicId === UNCATEGORIZED_ID) {
    const items = await db.capturedItem.findMany({
      where: { userId: args.userId, topics: { none: {} } },
      orderBy: { capturedAt: "desc" },
      include: CAPTURE_DETAIL_INCLUDE,
    });
    return {
      topicId: UNCATEGORIZED_ID,
      name: "Uncategorized",
      kind: "uncategorized",
      subfolders: [],
      entries: items.map(withLeadInsight),
    };
  }

  const topic = await db.topic.findUnique({
    where: { id: args.topicId },
    select: { id: true, name: true, slug: true },
  });
  if (!topic) {
    throw new AppError("TOPIC_NOT_FOUND", "Topic not found", 404);
  }

  const kind: ArchiveFolderKind = isGeneralTopic(topic.name) ? "general" : "specific";

  const items = await db.capturedItem.findMany({
    where: { userId: args.userId, topics: { some: { topicId: topic.id } } },
    orderBy: { capturedAt: "desc" },
    include: CAPTURE_DETAIL_INCLUDE,
  });

  if (kind === "specific") {
    return {
      topicId: topic.id,
      name: topic.name,
      kind,
      subfolders: [],
      entries: items.map(withLeadInsight),
    };
  }

  const subfolders = new Map<string, FolderAgg>();
  const directEntries: (typeof items)[number][] = [];

  for (const item of items) {
    const specificRows = item.topics.filter((row) => !isGeneralTopic(row.topic.name));
    if (specificRows.length === 0) {
      directEntries.push(item);
      continue;
    }
    for (const row of specificRows) {
      touchFolder(
        subfolders,
        { topicId: row.topic.id, name: row.topic.name, slug: row.topic.slug, kind: "specific" },
        item.id,
        item.capturedAt,
      );
    }
  }

  return {
    topicId: topic.id,
    name: topic.name,
    kind,
    subfolders: Array.from(subfolders.values())
      .map(toSummary)
      .sort((a, b) => b.latestActivity.localeCompare(a.latestActivity)),
    entries: directEntries.map(withLeadInsight),
  };
}
