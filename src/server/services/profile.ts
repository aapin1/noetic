import { Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { buildIdentitySummary } from "@/server/profile-summary";
import type { DbClient } from "@/server/db";
import { buildTasteVectors, suggestSimilarUsers } from "@/server/services/taste";
import { viewerFollowsUser, visibleActivityWhere, visibleLogWhere, visibleRankingWhere, visibleReviewWhere } from "@/server/viewer";

async function topicNames(db: DbClient, topicIds: string[]) {
  if (topicIds.length === 0) {
    return [] as string[];
  }

  const topics = await db.topic.findMany({
    where: { id: { in: topicIds } },
    select: { id: true, name: true },
  });
  const map = new Map(topics.map((topic) => [topic.id, topic.name]));

  return topicIds.map((topicId) => map.get(topicId)).filter(Boolean) as string[];
}

async function sourceNames(db: DbClient, sourceIds: string[]) {
  if (sourceIds.length === 0) {
    return [] as string[];
  }

  const sources = await db.contentSource.findMany({
    where: { id: { in: sourceIds } },
    select: { id: true, name: true },
  });
  const map = new Map(sources.map((source) => [source.id, source.name]));

  return sourceIds.map((sourceId) => map.get(sourceId)).filter(Boolean) as string[];
}

async function contentTypeNames(db: DbClient, contentTypeIds: string[]) {
  if (contentTypeIds.length === 0) {
    return [] as string[];
  }

  const types = await db.contentType.findMany({
    where: { id: { in: contentTypeIds } },
    select: { id: true, name: true },
  });
  const map = new Map(types.map((type) => [type.id, type.name]));

  return contentTypeIds.map((typeId) => map.get(typeId)).filter(Boolean) as string[];
}

export async function recomputeProfileSummary(userId: string, db: DbClient = prisma) {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!profile) {
    return null;
  }

  const vectors = await buildTasteVectors({
    userId,
    viewerId: userId,
    db,
  });

  const [topTopics, topSources, recentContentTypes] = await Promise.all([
    topicNames(db, vectors.topTopicIds.slice(0, 3)),
    sourceNames(db, vectors.topSourceIds.slice(0, 3)),
    contentTypeNames(db, vectors.topContentTypeIds.slice(0, 3)),
  ]);

  return db.profile.update({
    where: { userId },
    data: {
      identitySummary: buildIdentitySummary({
        topTopics,
        topSources,
        recentContentTypes,
      }),
    },
  });
}

export async function getComposedProfile(args: {
  handle?: string;
  userId?: string;
  viewerId?: string | null;
  ownerView?: boolean;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const viewerId = args.viewerId ?? null;
  const user = await db.user.findFirst({
    where: args.userId ? { id: args.userId } : { profile: { handle: args.handle } },
    include: {
      profile: true,
    },
  });

  if (!user?.profile) {
    throw new AppError("PROFILE_NOT_FOUND", "Profile not found", 404);
  }

  const isOwner = args.ownerView ?? viewerId === user.id;
  const [vectors, followState, activityWhere, logWhere, reviewWhere, rankingWhere] = await Promise.all([
    buildTasteVectors({
      userId: user.id,
      viewerId,
      db,
      includePrivateIfOwner: isOwner,
    }),
    viewerFollowsUser(db, viewerId, user.id),
    visibleActivityWhere(db, viewerId, user.id),
    visibleLogWhere(db, viewerId, user.id),
    visibleReviewWhere(db, viewerId, user.id),
    visibleRankingWhere(db, viewerId, user.id),
  ]);

  const [recentActivity, recentReviews, rankingLists, recentLogs, similarPeople] = await Promise.all([
    db.activityEvent.findMany({
      where: activityWhere,
      include: {
        contentItem: {
          include: {
            source: true,
            contentType: true,
          },
        },
        review: true,
        rankingList: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 15,
    }),
    db.review.findMany({
      where: reviewWhere,
      include: {
        logEntry: {
          include: {
            contentItem: true,
          },
        },
        likes: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.rankingList.findMany({
      where: rankingWhere,
      include: {
        items: {
          include: {
            contentItem: true,
          },
          orderBy: { position: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    db.logEntry.findMany({
      where: logWhere,
      include: {
        contentItem: {
          include: {
            source: true,
            contentType: true,
          },
        },
        review: true,
        topics: {
          include: { topic: true },
        },
      },
      orderBy: { loggedAt: "desc" },
      take: 10,
    }),
    isOwner ? suggestSimilarUsers({ userId: user.id, db }) : [],
  ]);

  return {
    user: {
      id: user.id,
      name: user.name,
      image: user.image,
      // Owner-only: the timeline anchors on this; not exposed on public profiles.
      createdAt: isOwner ? user.createdAt : null,
      profile: user.profile,
    },
    visibilityContext: {
      isOwner,
      followsUser: followState,
    },
    summary: user.profile.identitySummary,
    weightedVectors: vectors,
    topTopics: await topicNames(db, vectors.topTopicIds),
    recentActivity,
    recentReviews,
    rankingLists,
    recentLogs,
    similarPeople,
  };
}

export async function getPublicProfile(handle: string, viewerId?: string | null, db: DbClient = prisma) {
  return getComposedProfile({ handle, viewerId, ownerView: false, db });
}

export async function getOwnerProfile(userId: string, db: DbClient = prisma) {
  const profile = await getComposedProfile({ userId, viewerId: userId, ownerView: true, db });

  if (!profile.user.profile.isOnboarded) {
    throw new AppError("PROFILE_NOT_ONBOARDED", "Onboarding is incomplete", 409);
  }

  return profile;
}

export async function getPublicTopicPage(args: {
  slug: string;
  viewerId?: string | null;
  limit?: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const limit = args.limit ?? 10;
  const topic = await db.topic.findUnique({
    where: { slug: args.slug },
  });

  if (!topic) {
    throw new AppError("TOPIC_NOT_FOUND", "Topic not found", 404);
  }

  const [topUsers, topContent, recentReviews] = await Promise.all([
    db.userTopic.findMany({
      where: { topicId: topic.id },
      include: {
        user: {
          include: {
            profile: true,
          },
        },
      },
      orderBy: { weight: "desc" },
      take: limit,
    }),
    db.contentItem.findMany({
      where: {
        topics: {
          some: { topicId: topic.id },
        },
        logs: {
          some: {
            visibility: Visibility.PUBLIC,
          },
        },
      },
      include: {
        source: true,
        contentType: true,
        topics: {
          include: { topic: true },
        },
        _count: {
          select: { logs: true, rankingItems: true, saves: true },
        },
      },
      take: limit,
    }),
    db.review.findMany({
      where: {
        visibility: Visibility.PUBLIC,
        logEntry: {
          topics: {
            some: { topicId: topic.id },
          },
        },
      },
      include: {
        author: {
          include: { profile: true },
        },
        logEntry: {
          include: {
            contentItem: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);

  return {
    topic,
    summary: `Public activity around ${topic.name}`,
    topUsers: topUsers.filter((entry) => entry.user.profile?.isOnboarded).map((entry) => ({
      userId: entry.user.id,
      handle: entry.user.profile?.handle,
      displayName: entry.user.profile?.displayName,
      weight: entry.weight,
    })),
    topContent,
    recentReviews,
  };
}
