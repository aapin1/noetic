import { ActivityType, Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient, RootDbClient } from "@/server/db";
import { SIGNAL_WEIGHTS } from "@/server/weights";
import { upsertTopics } from "@/server/topics";
import { applyTopicWeights, incrementTasteProfileVersion, recordActivityEvent } from "@/server/services/activity";
import { recomputeProfileSummary } from "@/server/services/profile";

export async function createLogEntry(args: {
  userId: string;
  contentItemId: string;
  rating?: number;
  annotation?: string;
  review?: string;
  topics: string[];
  visibility: Visibility;
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const contentItem = await db.contentItem.findUnique({
    where: { id: args.contentItemId },
    include: {
      topics: {
        select: { topicId: true },
      },
    },
  });

  if (!contentItem) {
    throw new AppError("CONTENT_NOT_FOUND", "Content item not found", 404);
  }

  const existing = await db.logEntry.findUnique({
    where: {
      userId_contentItemId: {
        userId: args.userId,
        contentItemId: args.contentItemId,
      },
    },
  });

  if (existing) {
    throw new AppError("LOG_ALREADY_EXISTS", "A log entry already exists for this content", 409);
  }

  return db.$transaction(async (tx: DbClient) => {
    const logEntry = await tx.logEntry.create({
      data: {
        userId: args.userId,
        contentItemId: args.contentItemId,
        rating: args.rating,
        annotation: args.annotation,
        visibility: args.visibility,
      },
    });

    const topicRecords = await upsertTopics(tx, args.topics);

    if (topicRecords.length > 0) {
      await tx.logEntryTopic.createMany({
        data: topicRecords.map((topic) => ({
          logEntryId: logEntry.id,
          topicId: topic.id,
        })),
      });
    }

    let review = null as Awaited<ReturnType<typeof tx.review.create>> | null;

    if (args.review) {
      review = await tx.review.create({
        data: {
          logEntryId: logEntry.id,
          authorId: args.userId,
          content: args.review,
          visibility: args.visibility,
        },
      });
    }

    const topicIds = [...new Set([...topicRecords.map((topic) => topic.id), ...contentItem.topics.map((topic) => topic.topicId)])];
    let increment = SIGNAL_WEIGHTS.log;

    if (args.rating) {
      increment += SIGNAL_WEIGHTS.rating;
    }

    if (args.review) {
      increment += SIGNAL_WEIGHTS.review;
    }

    await applyTopicWeights({
      db: tx,
      userId: args.userId,
      topicIds,
      increment,
      occurredAt: logEntry.loggedAt,
    });
    await recordActivityEvent({
      db: tx,
      actorId: args.userId,
      contentItemId: args.contentItemId,
      logEntryId: logEntry.id,
      reviewId: review?.id,
      type: args.review ? ActivityType.REVIEWED_CONTENT : ActivityType.LOGGED_CONTENT,
      weight: increment,
      visibility: args.visibility,
      occurredAt: logEntry.loggedAt,
    });
    await incrementTasteProfileVersion(tx, args.userId);

    const result = await tx.logEntry.findUniqueOrThrow({
      where: { id: logEntry.id },
      include: {
        review: true,
        contentItem: {
          include: {
            source: true,
            contentType: true,
            topics: {
              include: { topic: true },
            },
          },
        },
        topics: {
          include: { topic: true },
        },
      },
    });

    await recomputeProfileSummary(args.userId, tx);

    return result;
  });
}

export async function updateReview(args: {
  userId: string;
  logEntryId: string;
  content: string;
  visibility: Visibility;
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const logEntry = await db.logEntry.findUnique({
    where: { id: args.logEntryId },
    include: {
      topics: {
        select: { topicId: true },
      },
      contentItem: {
        include: {
          topics: {
            select: { topicId: true },
          },
        },
      },
    },
  });

  if (!logEntry || logEntry.userId !== args.userId) {
    throw new AppError("LOG_NOT_FOUND", "Log entry not found", 404);
  }

  return db.$transaction(async (tx: DbClient) => {
    const review = await tx.review.upsert({
      where: { logEntryId: args.logEntryId },
      update: {
        content: args.content,
        visibility: args.visibility,
      },
      create: {
        logEntryId: args.logEntryId,
        authorId: args.userId,
        content: args.content,
        visibility: args.visibility,
      },
    });

    const topicIds = [...new Set([...logEntry.topics.map((topic) => topic.topicId), ...logEntry.contentItem.topics.map((topic) => topic.topicId)])];
    await applyTopicWeights({
      db: tx,
      userId: args.userId,
      topicIds,
      increment: SIGNAL_WEIGHTS.review,
    });
    await recordActivityEvent({
      db: tx,
      actorId: args.userId,
      contentItemId: logEntry.contentItemId,
      logEntryId: logEntry.id,
      reviewId: review.id,
      type: ActivityType.REVIEWED_CONTENT,
      weight: SIGNAL_WEIGHTS.review,
      visibility: args.visibility,
    });
    await incrementTasteProfileVersion(tx, args.userId);
    await recomputeProfileSummary(args.userId, tx);

    return review;
  });
}
