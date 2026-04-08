import { ActivityType } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { normalizeRankingOrder } from "@/server/rankings";
import type { DbClient, RootDbClient } from "@/server/db";
import { SIGNAL_WEIGHTS } from "@/server/weights";
import { applyTopicWeights, incrementTasteProfileVersion, recordActivityEvent } from "@/server/services/activity";
import { recomputeProfileSummary } from "@/server/services/profile";

async function contentTopicsForItems(db: DbClient, contentItemIds: string[]) {
  const items = await db.contentItem.findMany({
    where: { id: { in: contentItemIds } },
    include: {
      topics: {
        select: { topicId: true },
      },
    },
  });

  const topicIds = [...new Set(items.flatMap((item) => item.topics.map((topic) => topic.topicId)))];

  return {
    items,
    topicIds,
  };
}

export async function upsertRankingList(args: {
  userId: string;
  rankingListId?: string;
  title: string;
  description?: string;
  visibility: "PUBLIC" | "PRIVATE" | "FOLLOWERS";
  items: Array<{ contentItemId: string; note?: string }>;
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const order = normalizeRankingOrder(args.items.map((item) => item.contentItemId));
  const itemMap = new Map(args.items.map((item) => [item.contentItemId, item]));

  return db.$transaction(async (tx: DbClient) => {
    const rankingList = args.rankingListId
      ? await tx.rankingList.findUnique({ where: { id: args.rankingListId } })
      : null;

    if (rankingList && rankingList.userId !== args.userId) {
      throw new AppError("FORBIDDEN", "You cannot update this ranking list", 403);
    }

    const savedList = rankingList
      ? await tx.rankingList.update({
          where: { id: rankingList.id },
          data: {
            title: args.title,
            description: args.description,
            visibility: args.visibility,
          },
        })
      : await tx.rankingList.create({
          data: {
            userId: args.userId,
            title: args.title,
            description: args.description,
            visibility: args.visibility,
          },
        });

    await tx.rankedItem.deleteMany({
      where: { rankingListId: savedList.id },
    });

    await tx.rankedItem.createMany({
      data: order.map((entry) => ({
        rankingListId: savedList.id,
        contentItemId: entry.contentItemId,
        position: entry.position,
        note: itemMap.get(entry.contentItemId)?.note,
      })),
    });

    const { topicIds } = await contentTopicsForItems(tx, order.map((entry) => entry.contentItemId));
    await applyTopicWeights({
      db: tx,
      userId: args.userId,
      topicIds,
      increment: SIGNAL_WEIGHTS.ranking,
    });
    await recordActivityEvent({
      db: tx,
      actorId: args.userId,
      rankingListId: savedList.id,
      contentItemId: order[0]?.contentItemId,
      type: ActivityType.RANKED_CONTENT,
      weight: SIGNAL_WEIGHTS.ranking,
      visibility: args.visibility,
    });
    await incrementTasteProfileVersion(tx, args.userId);
    await recomputeProfileSummary(args.userId, tx);

    return tx.rankingList.findUniqueOrThrow({
      where: { id: savedList.id },
      include: {
        items: {
          include: {
            contentItem: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });
  });
}

export async function reorderRankingItems(args: {
  userId: string;
  rankingListId: string;
  contentItemIds: string[];
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const order = normalizeRankingOrder(args.contentItemIds);

  return db.$transaction(async (tx: DbClient) => {
    const rankingList = await tx.rankingList.findUnique({
      where: { id: args.rankingListId },
    });

    if (!rankingList || rankingList.userId !== args.userId) {
      throw new AppError("RANKING_NOT_FOUND", "Ranking list not found", 404);
    }

    const existingCount = await tx.rankedItem.count({
      where: { rankingListId: args.rankingListId },
    });

    if (existingCount !== order.length) {
      throw new AppError("INVALID_REORDER", "Reorder payload must include every ranked item exactly once", 400);
    }

    for (const entry of order) {
      await tx.rankedItem.update({
        where: {
          rankingListId_contentItemId: {
            rankingListId: args.rankingListId,
            contentItemId: entry.contentItemId,
          },
        },
        data: {
          position: entry.position,
        },
      });
    }

    await recordActivityEvent({
      db: tx,
      actorId: args.userId,
      rankingListId: args.rankingListId,
      contentItemId: order[0]?.contentItemId,
      type: ActivityType.RANKED_CONTENT,
      weight: SIGNAL_WEIGHTS.ranking,
      visibility: rankingList.visibility,
    });
    await incrementTasteProfileVersion(tx, args.userId);
    await recomputeProfileSummary(args.userId, tx);

    return tx.rankingList.findUniqueOrThrow({
      where: { id: args.rankingListId },
      include: {
        items: {
          include: {
            contentItem: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });
  });
}
