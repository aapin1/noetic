import { ActivityType, NotificationType, Visibility, type Prisma } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { SIGNAL_WEIGHTS, TOP_FOLLOW_TOPICS } from "@/server/weights";
import { createNotification } from "@/server/services/notifications";
import { applyTopicWeights, getPublicTopicIdsForUser, incrementTasteProfileVersion, recordActivityEvent } from "@/server/services/activity";
import { recomputeProfileSummary } from "@/server/services/profile";
import { getMemoryGraph, pickRisingTopic } from "@/server/services/memory";

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

export async function getFeed(args: {
  userId: string;
  cursor?: string;
  limit?: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const limit = Math.min(args.limit ?? 20, 40);

  const follows = await db.follow.findMany({
    where: { followerId: args.userId },
    select: { followingId: true },
  });

  const followedIds = follows.map((f) => f.followingId);

  if (followedIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  const where: Prisma.CapturedItemWhereInput = {
    userId: { in: followedIds },
    ...(args.cursor
      ? { capturedAt: { lt: new Date(args.cursor) } }
      : {}),
  };

  const captures = await db.capturedItem.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: limit + 1,
    include: {
      contentItem: { select: { title: true } },
      topics: { include: { topic: { select: { name: true } } } },
      user: {
        select: {
          id: true,
          profile: { select: { handle: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  });

  const hasMore = captures.length > limit;
  const page = hasMore ? captures.slice(0, limit) : captures;
  const nextCursor = hasMore ? page[page.length - 1]!.capturedAt.toISOString() : null;

  const items = page.map((item) => ({
    id: item.id,
    capturedAt: item.capturedAt.toISOString(),
    title: item.contentItem?.title ?? item.rawText?.slice(0, 120) ?? item.caption?.slice(0, 120) ?? null,
    rawText: item.rawText,
    keyIdea: item.keyIdea,
    kind: item.kind,
    topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),

    author: {
      id: item.user.id,
      handle: item.user.profile?.handle ?? item.user.id,
      displayName: item.user.profile?.displayName ?? "Unknown",
      avatarUrl: item.user.profile?.avatarUrl ?? null,
    },
  }));

  return { items, nextCursor };
}

// How much of each followed person's world the pulse shows at a glance: enough
// nodes to read the shape of their map, a handful of their most recent logs.
const PULSE_MAP_NODES = 60;
const USER_SEARCH_LIMIT = 20;

/** Shortest query a trigram index can serve; below this Postgres ignores it. */
const TRIGRAM_MIN_LENGTH = 3;

type ProfileSearchRow = {
  userId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
};

/** `%`, `_` and `\` are LIKE wildcards — a raw `%` would otherwise match everyone. */
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Find people by handle or display name.
 *
 * Two paths, because a trigram index cannot serve a query shorter than three
 * characters:
 *
 * - 1-2 chars: handle prefix only, in handle order. Handles are stored
 *   lowercase, so the btree on `handle` supplies the ordering and Postgres
 *   stops as soon as it has filled the limit instead of reading the table.
 * - 3+ chars: substring and fuzzy matching over handle and display name,
 *   served by the trigram indexes, then ranked so the closest match is first.
 *
 * Either way the database returns at most USER_SEARCH_LIMIT already-ranked
 * rows, so the cost is flat as the user table grows.
 */
export async function searchProfiles(args: { userId: string; query: string; db?: DbClient }) {
  const db = args.db ?? prisma;
  const query = args.query.trim().toLowerCase();

  if (!query) return { users: [] };

  const prefix = `${escapeLike(query)}%`;

  const rows =
    query.length < TRIGRAM_MIN_LENGTH
      ? await db.$queryRaw<ProfileSearchRow[]>`
          SELECT p."userId", p."handle", p."displayName", p."avatarUrl"
          FROM "Profile" p
          WHERE p."userId" <> ${args.userId}
            AND p."handle" LIKE ${prefix}
          ORDER BY p."handle" ASC
          LIMIT ${USER_SEARCH_LIMIT}
        `
      : await db.$queryRaw<ProfileSearchRow[]>`
          SELECT p."userId", p."handle", p."displayName", p."avatarUrl"
          FROM "Profile" p
          WHERE p."userId" <> ${args.userId}
            AND (
              p."handle" ILIKE ${`%${escapeLike(query)}%`}
              OR p."displayName" ILIKE ${`%${escapeLike(query)}%`}
              OR p."handle" % ${query}
              OR p."displayName" % ${query}
            )
          ORDER BY
            CASE
              WHEN p."handle" = ${query} THEN 0
              WHEN p."handle" LIKE ${prefix} THEN 1
              WHEN lower(p."displayName") LIKE ${prefix} THEN 2
              WHEN p."handle" ILIKE ${`%${escapeLike(query)}%`} THEN 3
              WHEN p."displayName" ILIKE ${`%${escapeLike(query)}%`} THEN 4
              ELSE 5
            END ASC,
            GREATEST(
              similarity(p."handle", ${query}),
              similarity(p."displayName", ${query})
            ) DESC,
            length(p."handle") ASC,
            p."handle" ASC
          LIMIT ${USER_SEARCH_LIMIT}
        `;

  return {
    users: rows.map((row) => ({
      id: row.userId,
      handle: row.handle,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
    })),
  };
}

const PULSE_LATEST_COUNT = 4;

/**
 * The pulse: for every person the viewer follows, a small version of their
 * semantic map plus their latest logs. One entry per followed user, newest
 * follows first. Reuses the same layout the person sees on their own map, so
 * the miniature is faithful to the real thing.
 */
export async function getPulse(args: { userId: string; db?: DbClient }) {
  const db = args.db ?? prisma;

  const follows = await db.follow.findMany({
    where: { followerId: args.userId },
    orderBy: { createdAt: "desc" },
    select: {
      following: {
        select: {
          id: true,
          profile: {
            select: {
              handle: true,
              displayName: true,
              avatarUrl: true,
              identitySummary: true,
            },
          },
        },
      },
    },
  });

  const friends = await Promise.all(
    follows.map(async ({ following: user }) => {
      const graph = await getMemoryGraph({ userId: user.id, limit: PULSE_MAP_NODES, db });

      // Nodes arrive newest-first, so the head of the list is the latest logs.
      const latest = graph.nodes.slice(0, PULSE_LATEST_COUNT).map((node) => ({
        id: node.id,
        title: node.label,
        keyIdea: node.keyIdea,
        kind: node.kind,
        capturedAt: node.capturedAt.toISOString(),
        topics: node.topics,
      }));

      // What this person is getting into lately — the same signal the viewer's
      // own info panel shows for themselves, so the two can't disagree. Derived
      // from the nodes already fetched above, so it costs no extra query. Those
      // nodes are capped at PULSE_MAP_NODES, so for a very prolific person the
      // prior window can be clipped and the lift reads a little eager; that's
      // an acceptable trade against doubling the query count of the pulse.
      const rising = pickRisingTopic(
        graph.nodes.map((node) => ({ capturedAt: node.capturedAt, topics: node.topics })),
        { recentDays: 7, priorDays: 30 },
      );

      return {
        user: {
          id: user.id,
          handle: user.profile?.handle ?? user.id,
          displayName: user.profile?.displayName ?? "Unknown",
          avatarUrl: user.profile?.avatarUrl ?? null,
          identitySummary: user.profile?.identitySummary ?? null,
        },
        // Their true capture total, not `nodes.length` — the node list is capped
        // at PULSE_MAP_NODES, so counting it would quietly under-report a
        // prolific person's map as exactly 60 points forever.
        captureCount: graph.totalCount,
        rising,
        map: {
          nodes: graph.nodes.map((node) => ({
            id: node.id,
            x: node.x,
            y: node.y,
            kind: node.kind,
            topics: node.topics,
          })),
          clusters: graph.clusters.map((cluster) => ({
            topicId: cluster.topicId,
            name: cluster.name,
            kind: cluster.kind,
            count: cluster.count,
          })),
        },
        latest,
      };
    }),
  );

  return { friends };
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
