import { Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recencyDecay } from "@/server/decay";
import { calculateFeedScore } from "@/server/feed-score";
import type { DbClient } from "@/server/db";
import { buildTasteVectors, suggestSimilarUsers } from "@/server/services/taste";

function overlapRatio(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const overlap = left.filter((value) => rightSet.has(value)).length;

  return overlap / Math.max(left.length, right.length);
}

export async function getFeed(args: {
  userId: string;
  sort?: "relevance" | "chronological";
  limit?: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const limit = args.limit ?? 20;
  const viewerVectors = await buildTasteVectors({
    userId: args.userId,
    viewerId: args.userId,
    db,
  });
  const [follows, similarUsers, activityEvents, trendingCandidates] = await Promise.all([
    db.follow.findMany({
      where: { followerId: args.userId },
      select: { followingId: true },
    }),
    suggestSimilarUsers({ userId: args.userId, limit: 10, db }),
    db.activityEvent.findMany({
      where: {
        actorId: { not: args.userId },
        visibility: Visibility.PUBLIC,
      },
      include: {
        actor: {
          include: {
            profile: true,
          },
        },
        contentItem: {
          include: {
            source: true,
            contentType: true,
            topics: {
              select: { topicId: true },
            },
          },
        },
        review: true,
        rankingList: true,
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
    db.activityEvent.findMany({
      where: {
        visibility: Visibility.PUBLIC,
        contentItemId: { not: null },
      },
      include: {
        contentItem: {
          include: {
            source: true,
            contentType: true,
            topics: {
              select: { topicId: true },
            },
          },
        },
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
    }),
  ]);

  const followedIds = new Set(follows.map((follow) => follow.followingId));
  const similarScoreMap = new Map(similarUsers.map((user) => [user.id, user.score / 100]));
  const viewerTopicIds = viewerVectors.topTopicIds;

  const activityItems = activityEvents.map((event) => {
    const eventTopicIds = event.contentItem?.topics.map((topic) => topic.topicId) ?? [];
    const score = calculateFeedScore({
      followWeight: followedIds.has(event.actorId) ? 1 : 0,
      similarityWeight: similarScoreMap.get(event.actorId) ?? 0,
      topicOverlap: overlapRatio(viewerTopicIds, eventTopicIds),
      recencyDecay: recencyDecay(event.occurredAt),
    });

    return {
      kind: "activity" as const,
      id: event.id,
      score,
      occurredAt: event.occurredAt,
      actor: {
        id: event.actor.id,
        handle: event.actor.profile?.handle,
        displayName: event.actor.profile?.displayName,
      },
      event,
      reason: {
        followed: followedIds.has(event.actorId),
        similar: similarScoreMap.get(event.actorId) ?? 0,
        topicOverlap: overlapRatio(viewerTopicIds, eventTopicIds),
      },
    };
  });

  const trendingMap = new Map<string, { contentItem: NonNullable<(typeof trendingCandidates)[number]["contentItem"]>; score: number; occurredAt: Date }>();

  for (const event of trendingCandidates) {
    if (!event.contentItem) {
      continue;
    }

    const previous = trendingMap.get(event.contentItem.id);
    const nextScore = (previous?.score ?? 0) + recencyDecay(event.occurredAt);

    trendingMap.set(event.contentItem.id, {
      contentItem: event.contentItem,
      score: nextScore,
      occurredAt: previous?.occurredAt && previous.occurredAt > event.occurredAt ? previous.occurredAt : event.occurredAt,
    });
  }

  const trendingItems = [...trendingMap.entries()].map(([contentItemId, value]) => ({
    kind: "trending_content" as const,
    id: `trending:${contentItemId}`,
    score: calculateFeedScore({
      followWeight: 0,
      similarityWeight: 0,
      topicOverlap: overlapRatio(viewerTopicIds, value.contentItem.topics.map((topic) => topic.topicId)),
      recencyDecay: Math.min(1, value.score),
    }),
    occurredAt: value.occurredAt,
    contentItem: value.contentItem,
  }));

  const combined = [...activityItems, ...trendingItems];

  if (combined.length === 0) {
    throw new AppError("EMPTY_FEED", "No public activity is available yet", 404);
  }

  const sorted = args.sort === "chronological"
    ? combined.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    : combined.sort((a, b) => b.score - a.score || b.occurredAt.getTime() - a.occurredAt.getTime());

  return sorted.slice(0, limit);
}
