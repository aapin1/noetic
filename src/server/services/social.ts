import { ActivityType, NotificationType, Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { SIGNAL_WEIGHTS, TOP_FOLLOW_TOPICS } from "@/server/weights";
import { createNotification } from "@/server/services/notifications";
import { applyTopicWeights, getPublicTopicIdsForUser, incrementTasteProfileVersion, recordActivityEvent } from "@/server/services/activity";
import { recomputeProfileSummary } from "@/server/services/profile";

export async function followUser(userId: string, targetUserId: string, db: DbClient = prisma) {
  if (userId === targetUserId) {
    throw new AppError("INVALID_FOLLOW", "You cannot follow yourself", 400);
  }

  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true },
  });

  if (!target) {
    throw new AppError("USER_NOT_FOUND", "Target user not found", 404);
  }

  const existing = await db.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: targetUserId,
      },
    },
  });

  if (existing) {
    throw new AppError("ALREADY_FOLLOWING", "You already follow this user", 409);
  }

  const follow = await db.follow.create({
    data: {
      followerId: userId,
      followingId: targetUserId,
    },
  });

  const topicIds = await getPublicTopicIdsForUser(db, targetUserId, TOP_FOLLOW_TOPICS);
  await applyTopicWeights({
    db,
    userId,
    topicIds,
    increment: SIGNAL_WEIGHTS.followTopicBoost,
  });
  await recordActivityEvent({
    db,
    actorId: userId,
    targetUserId,
    followId: follow.id,
    type: ActivityType.FOLLOWED_USER,
    weight: SIGNAL_WEIGHTS.followTopicBoost,
    visibility: Visibility.PUBLIC,
  });
  await createNotification({
    db,
    recipientId: targetUserId,
    actorId: userId,
    type: NotificationType.NEW_FOLLOW,
    deepLink: `/profile/${userId}`,
    payload: { targetUserId },
  });
  await incrementTasteProfileVersion(db, userId);
  await recomputeProfileSummary(userId, db);

  return {
    following: true,
    follow,
  };
}

export async function unfollowUser(userId: string, targetUserId: string, db: DbClient = prisma) {
  const existing = await db.follow.findUnique({
    where: {
      followerId_followingId: {
        followerId: userId,
        followingId: targetUserId,
      },
    },
  });

  if (!existing) {
    throw new AppError("FOLLOW_NOT_FOUND", "Follow relationship not found", 404);
  }

  await db.follow.delete({
    where: { id: existing.id },
  });

  await incrementTasteProfileVersion(db, userId);
  await recomputeProfileSummary(userId, db);

  return {
    following: false,
    targetUserId,
  };
}

export async function likeReview(userId: string, reviewId: string, db: DbClient = prisma) {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    include: {
      author: true,
      logEntry: true,
      _count: {
        select: { likes: true },
      },
    },
  });

  if (!review || review.visibility === Visibility.PRIVATE) {
    throw new AppError("REVIEW_NOT_FOUND", "Review not found", 404);
  }

  const existing = await db.like.findUnique({
    where: {
      userId_reviewId: {
        userId,
        reviewId,
      },
    },
  });

  if (existing) {
    throw new AppError("ALREADY_LIKED", "You already liked this review", 409);
  }

  const like = await db.like.create({
    data: {
      userId,
      reviewId,
    },
  });

  if (review.authorId !== userId) {
    await createNotification({
      db,
      recipientId: review.authorId,
      actorId: userId,
      type: NotificationType.NEW_LIKE,
      deepLink: `/content/${review.logEntry.contentItemId}`,
      payload: { reviewId },
    });
  }

  return {
    liked: true,
    like,
    likeCount: review._count.likes + 1,
  };
}

export async function saveContent(userId: string, contentItemId: string, db: DbClient = prisma) {
  const contentItem = await db.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      topics: {
        select: { topicId: true },
      },
    },
  });

  if (!contentItem) {
    throw new AppError("CONTENT_NOT_FOUND", "Content item not found", 404);
  }

  const existing = await db.save.findUnique({
    where: {
      userId_contentItemId: {
        userId,
        contentItemId,
      },
    },
  });

  if (existing) {
    throw new AppError("ALREADY_SAVED", "You already saved this content", 409);
  }

  const save = await db.save.create({
    data: {
      userId,
      contentItemId,
    },
  });

  await applyTopicWeights({
    db,
    userId,
    topicIds: contentItem.topics.map((topic) => topic.topicId),
    increment: SIGNAL_WEIGHTS.save,
  });
  await recordActivityEvent({
    db,
    actorId: userId,
    contentItemId,
    type: ActivityType.SAVED_CONTENT,
    weight: SIGNAL_WEIGHTS.save,
    visibility: Visibility.PUBLIC,
  });
  await incrementTasteProfileVersion(db, userId);
  await recomputeProfileSummary(userId, db);

  return {
    saved: true,
    save,
  };
}

export async function commentOnReview(args: {
  userId: string;
  reviewId: string;
  parentId?: string;
  content: string;
  visibility: Visibility;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const review = await db.review.findUnique({
    where: { id: args.reviewId },
    include: {
      logEntry: true,
    },
  });

  if (!review || review.visibility === Visibility.PRIVATE) {
    throw new AppError("REVIEW_NOT_FOUND", "Review not found", 404);
  }

  if (args.parentId) {
    const parent = await db.comment.findUnique({
      where: { id: args.parentId },
    });

    if (!parent || parent.reviewId !== args.reviewId) {
      throw new AppError("INVALID_PARENT", "Reply target is invalid", 400);
    }
  }

  const comment = await db.comment.create({
    data: {
      authorId: args.userId,
      reviewId: args.reviewId,
      parentId: args.parentId,
      content: args.content,
      visibility: args.visibility,
    },
  });

  await recordActivityEvent({
    db,
    actorId: args.userId,
    contentItemId: review.logEntry.contentItemId,
    reviewId: args.reviewId,
    commentId: comment.id,
    type: ActivityType.COMMENTED,
    weight: 1,
    visibility: args.visibility,
  });

  const notificationType = args.parentId ? NotificationType.NEW_REPLY : NotificationType.NEW_COMMENT;
  const recipientId = args.parentId
    ? (await db.comment.findUnique({ where: { id: args.parentId }, select: { authorId: true } }))?.authorId
    : review.authorId;

  if (recipientId && recipientId !== args.userId) {
    await createNotification({
      db,
      recipientId,
      actorId: args.userId,
      type: notificationType,
      deepLink: `/content/${review.logEntry.contentItemId}`,
      payload: { reviewId: args.reviewId, commentId: comment.id },
    });
  }

  return {
    comment,
  };
}
