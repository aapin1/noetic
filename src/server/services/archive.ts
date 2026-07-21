import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import { captureSummarySelect, withLeadInsight, type CaptureListItem } from "@/server/services/cognition";

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

// Narrow select rather than `include`: an include drags every scalar, which
// here means the 1536-float embedding on each capture and the full scraped
// article body on each linked ContentItem — neither of which the archive
// renders. See `captureSummarySelect`.
const CAPTURE_DETAIL_SELECT = {
  ...captureSummarySelect,
  insights: {
    select: { id: true, type: true, headline: true },
    orderBy: { strength: "desc" as const },
    take: 1,
  },
};

type TopicRow = { weight: number; topic: { id: string; name: string; slug: string } };

/** The heaviest topic of a kind — for a general, the field the classifier led
 * with at 1.0, which is also the anchor the map clusters the node on. Ties break
 * on id so the filing is stable across requests. */
function primaryTopic(topics: TopicRow[], kind: "general" | "specific"): TopicRow | null {
  const wanted = kind === "general";
  return (
    topics
      .filter((row) => isGeneralTopic(row.topic.name) === wanted)
      .sort((a, b) => b.weight - a.weight || a.topic.id.localeCompare(b.topic.id))[0] ?? null
  );
}

/**
 * The single top-level folder a capture belongs in — its leading field, or its
 * leading sub-topic when the classifier found no field at all (null =
 * uncategorized). The archive is a filing cabinet, so a capture is filed in
 * exactly ONE place and folder counts sum to the total the map and the "you" tab
 * report. Interdisciplinary content is tagged with up to three fields; filing it
 * under all of them made one capture show up as three, and no count anywhere
 * could be reconciled by adding folders up.
 */
function homeFolder(
  topics: TopicRow[],
): { topicId: string; name: string; slug: string; kind: ArchiveFolderKind } | null {
  const general = primaryTopic(topics, "general");
  const row = general ?? primaryTopic(topics, "specific");
  if (!row) return null;
  return {
    topicId: row.topic.id,
    name: row.topic.name,
    slug: row.topic.slug,
    kind: general ? "general" : "specific",
  };
}

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

/** Top-level folders: one per general topic the user has entries filed under, plus
 * a fallback folder per specific topic for entries with no general topic at all,
 * plus a single "Uncategorized" bucket for entries with no topics whatsoever.
 * Each capture lands in exactly one of them (see `homeFolder`). */
export async function listArchiveFolders(args: { userId: string; db?: DbClient }): Promise<ArchiveFolderSummary[]> {
  const db = args.db ?? prisma;
  const items = await db.capturedItem.findMany({
    where: { userId: args.userId },
    select: {
      id: true,
      capturedAt: true,
      topics: { select: { weight: true, topic: { select: { id: true, name: true, slug: true } } } },
    },
  });

  const folders = new Map<string, FolderAgg>();
  let uncategorizedCount = 0;
  let uncategorizedLatest: Date | null = null;

  for (const item of items) {
    const home = homeFolder(item.topics);

    if (home) {
      touchFolder(folders, home, item.id, item.capturedAt);
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

/** A single folder's contents — exactly the captures its tile counted, and no
 * others. For a general topic that means the items this field leads, split into
 * sub-folders (by the sub-topic each one leads with) and direct entries (items
 * with no sub-topic at all). For a specific topic or the uncategorized bucket,
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
      select: CAPTURE_DETAIL_SELECT,
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

  // Tagged with this topic is the superset; which of those it actually files
  // here is decided per item below, the same way the folder's count was.
  const items = await db.capturedItem.findMany({
    where: { userId: args.userId, topics: { some: { topicId: topic.id } } },
    orderBy: { capturedAt: "desc" },
    select: CAPTURE_DETAIL_SELECT,
  });

  if (kind === "specific") {
    // The items this sub-topic leads — whether they sit under a field (as one of
    // its sub-folders) or, lacking a field entirely, top-level under this topic.
    const led = items.filter((item) => primaryTopic(item.topics, "specific")?.topic.id === topic.id);
    return {
      topicId: topic.id,
      name: topic.name,
      kind,
      subfolders: [],
      entries: led.map(withLeadInsight),
    };
  }

  const subfolders = new Map<string, FolderAgg>();
  const directEntries: (typeof items)[number][] = [];

  for (const item of items) {
    // Tagged with this field, but another field leads it → it lives there, not here.
    if (homeFolder(item.topics)?.topicId !== topic.id) continue;

    const lead = primaryTopic(item.topics, "specific");
    if (!lead) {
      directEntries.push(item);
      continue;
    }
    touchFolder(
      subfolders,
      { topicId: lead.topic.id, name: lead.topic.name, slug: lead.topic.slug, kind: "specific" },
      item.id,
      item.capturedAt,
    );
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
