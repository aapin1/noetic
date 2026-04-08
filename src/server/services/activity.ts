import { ActivityType, Visibility, type Prisma } from "@prisma/client";
import type { DbClient } from "@/server/db";
import { recencyDecay } from "@/server/decay";

export async function incrementTasteProfileVersion(db: DbClient, userId: string) {
  await db.user.update({
    where: { id: userId },
    data: {
      tasteProfileVersion: {
        increment: 1,
      },
    },
  });
}

export async function applyTopicWeights(args: {
  db: DbClient;
  userId: string;
  topicIds: string[];
  increment: number;
  occurredAt?: Date;
}) {
  const { db, userId, increment } = args;
  const occurredAt = args.occurredAt ?? new Date();
  const topicIds = [...new Set(args.topicIds.filter(Boolean))];

  for (const topicId of topicIds) {
    const existing = await db.userTopic.findUnique({
      where: {
        userId_topicId: {
          userId,
          topicId,
        },
      },
      select: {
        id: true,
        weight: true,
        lastInteractedAt: true,
      },
    });

    const nextWeight = existing
      ? existing.weight * recencyDecay(existing.lastInteractedAt, occurredAt) + increment
      : increment;

    await db.userTopic.upsert({
      where: {
        userId_topicId: {
          userId,
          topicId,
        },
      },
      update: {
        weight: nextWeight,
        lastInteractedAt: occurredAt,
      },
      create: {
        userId,
        topicId,
        weight: nextWeight,
        lastInteractedAt: occurredAt,
      },
    });
  }
}

export async function recordActivityEvent(args: {
  db: DbClient;
  actorId: string;
  type: ActivityType;
  weight: number;
  visibility?: Visibility;
  occurredAt?: Date;
  contentItemId?: string;
  logEntryId?: string;
  reviewId?: string;
  rankingListId?: string;
  followId?: string;
  commentId?: string;
  shareEventId?: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}) {
  const {
    db,
    actorId,
    type,
    weight,
    visibility = Visibility.PUBLIC,
    occurredAt = new Date(),
    contentItemId,
    logEntryId,
    reviewId,
    rankingListId,
    followId,
    commentId,
    shareEventId,
    targetUserId,
    metadata,
  } = args;

  return db.activityEvent.create({
    data: {
      actorId,
      type,
      weight,
      visibility,
      occurredAt,
      contentItemId,
      logEntryId,
      reviewId,
      rankingListId,
      followId,
      commentId,
      shareEventId,
      targetUserId,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}

export async function getContentTopicIds(db: DbClient, contentItemId: string) {
  const topics = await db.contentItemTopic.findMany({
    where: { contentItemId },
    select: { topicId: true },
  });

  return topics.map((topic) => topic.topicId);
}

export async function getPublicTopicIdsForUser(db: DbClient, userId: string, limit = 6) {
  const recentLogs = await db.logEntry.findMany({
    where: {
      userId,
      visibility: Visibility.PUBLIC,
    },
    orderBy: { loggedAt: "desc" },
    take: limit,
    include: {
      topics: {
        select: { topicId: true },
      },
      contentItem: {
        select: {
          topics: {
            select: { topicId: true },
          },
        },
      },
    },
  });

  return [...new Set(recentLogs.flatMap((log) => {
    const logTopics = log.topics.map((topic) => topic.topicId);
    const contentTopics = log.contentItem.topics.map((topic) => topic.topicId);
    return [...logTopics, ...contentTopics];
  }))];
}
