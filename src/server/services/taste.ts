import { Visibility, type Prisma } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { recencyDecay } from "@/server/decay";
import type { DbClient } from "@/server/db";
import { cosineSimilarity, overlappingWeights, scaleSimilarityScore, type WeightedVector } from "@/server/similarity";
import { viewerFollowsUser } from "@/server/viewer";

type ActivityEventWithRelations = Prisma.ActivityEventGetPayload<{
  include: {
    contentItem: {
      include: {
        source: true;
        contentType: true;
        topics: {
          include: {
            topic: true;
          };
        };
      };
    };
    logEntry: {
      include: {
        topics: {
          include: {
            topic: true;
          };
        };
      };
    };
  };
}>;

export type TasteVectors = {
  topicVector: WeightedVector;
  sourceVector: WeightedVector;
  contentTypeVector: WeightedVector;
  combinedVector: WeightedVector;
  topTopicIds: string[];
  topSourceIds: string[];
  topContentTypeIds: string[];
};

function addWeight(vector: WeightedVector, key: string | null | undefined, value: number) {
  if (!key) {
    return;
  }

  vector[key] = (vector[key] ?? 0) + value;
}

export async function buildTasteVectors(args: {
  userId: string;
  viewerId?: string | null;
  db?: DbClient;
  includePrivateIfOwner?: boolean;
}) {
  const db = args.db ?? prisma;
  const viewerId = args.viewerId ?? null;
  const includePrivateIfOwner = args.includePrivateIfOwner ?? true;
  const ownsProfile = Boolean(viewerId && viewerId === args.userId && includePrivateIfOwner);
  const follows = ownsProfile ? false : await viewerFollowsUser(db, viewerId, args.userId);
  const where: Prisma.ActivityEventWhereInput = {
    actorId: args.userId,
  };

  if (!ownsProfile) {
    where.visibility = follows ? { in: [Visibility.PUBLIC, Visibility.FOLLOWERS] } : Visibility.PUBLIC;
  }

  const events: ActivityEventWithRelations[] = await db.activityEvent.findMany({
    where,
    include: {
      contentItem: {
        include: {
          source: true,
          contentType: true,
          topics: {
            include: { topic: true },
          },
        },
      },
      logEntry: {
        include: {
          topics: {
            include: { topic: true },
          },
        },
      },
    },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });

  const topicVector: WeightedVector = {};
  const sourceVector: WeightedVector = {};
  const contentTypeVector: WeightedVector = {};

  for (const event of events) {
    const weight = event.weight * recencyDecay(event.occurredAt);
    const contentTopics = event.contentItem?.topics.map((topic) => topic.topic) ?? [];
    const logTopics = event.logEntry?.topics.map((topic) => topic.topic) ?? [];
    const allTopics = [...contentTopics, ...logTopics];

    for (const topic of allTopics) {
      addWeight(topicVector, `topic:${topic.id}`, weight);
    }

    addWeight(sourceVector, event.contentItem?.sourceId ? `source:${event.contentItem.sourceId}` : undefined, weight);
    addWeight(contentTypeVector, event.contentItem?.contentTypeId ? `type:${event.contentItem.contentTypeId}` : undefined, weight);
  }

  const combinedVector: WeightedVector = {
    ...topicVector,
    ...sourceVector,
    ...contentTypeVector,
  };

  return {
    topicVector,
    sourceVector,
    contentTypeVector,
    combinedVector,
    topTopicIds: Object.entries(topicVector).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key]) => key.replace(/^topic:/, "")),
    topSourceIds: Object.entries(sourceVector).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key]) => key.replace(/^source:/, "")),
    topContentTypeIds: Object.entries(contentTypeVector).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key]) => key.replace(/^type:/, "")),
  } satisfies TasteVectors;
}

function comparisonKey(leftUserId: string, rightUserId: string) {
  return `${leftUserId}:${rightUserId}`;
}

async function visibleRankingsForComparison(db: DbClient, ownerId: string, viewerId: string) {
  const follows = ownerId === viewerId ? false : await viewerFollowsUser(db, viewerId, ownerId);

  return db.rankedItem.findMany({
    where: {
      rankingList: {
        userId: ownerId,
        visibility: ownerId === viewerId ? undefined : follows ? { in: [Visibility.PUBLIC, Visibility.FOLLOWERS] } : Visibility.PUBLIC,
      },
    },
    select: {
      contentItemId: true,
      position: true,
      contentItem: {
        select: { title: true },
      },
    },
  });
}

function rankingSimilarity(left: Awaited<ReturnType<typeof visibleRankingsForComparison>>, right: Awaited<ReturnType<typeof visibleRankingsForComparison>>) {
  const rightMap = new Map(right.map((item) => [item.contentItemId, item]));

  const overlaps = left
    .filter((item) => rightMap.has(item.contentItemId))
    .map((item) => {
      const rightItem = rightMap.get(item.contentItemId)!;
      const score = 1 / (1 + Math.abs(item.position - rightItem.position));
      return {
        contentItemId: item.contentItemId,
        title: item.contentItem.title,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const average = overlaps.length === 0 ? 0 : overlaps.reduce((sum, item) => sum + item.score, 0) / overlaps.length;

  return {
    score: average,
    overlaps: overlaps.slice(0, 5),
  };
}

async function namesForIds(db: DbClient, ids: string[], model: "topic" | "contentSource" | "contentType") {
  if (ids.length === 0) {
    return [] as { id: string; name: string }[];
  }

  if (model === "topic") {
    return db.topic.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  }

  if (model === "contentSource") {
    return db.contentSource.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  }

  return db.contentType.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
}

export async function compareUsers(args: {
  viewerId: string;
  targetUserId: string;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;

  if (args.viewerId === args.targetUserId) {
    throw new AppError("INVALID_COMPARISON", "You cannot compare a profile to itself", 400);
  }

  const [viewer, target] = await Promise.all([
    db.user.findUnique({ where: { id: args.viewerId }, select: { id: true, tasteProfileVersion: true } }),
    db.user.findUnique({ where: { id: args.targetUserId }, select: { id: true, tasteProfileVersion: true } }),
  ]);

  if (!viewer || !target) {
    throw new AppError("USER_NOT_FOUND", "One or both users were not found", 404);
  }

  const cacheKey = comparisonKey(args.viewerId, args.targetUserId);
  const cached = await db.comparisonCache.findUnique({
    where: { comparisonKey: cacheKey },
  });

  if (cached && cached.leftVersion === viewer.tasteProfileVersion && cached.rightVersion === target.tasteProfileVersion) {
    return cached;
  }

  const [viewerVectors, targetVectors] = await Promise.all([
    buildTasteVectors({ userId: args.viewerId, viewerId: args.viewerId, db }),
    buildTasteVectors({ userId: args.targetUserId, viewerId: args.viewerId, db }),
  ]);

  const baseScore = cosineSimilarity(viewerVectors.combinedVector, targetVectors.combinedVector);
  const rankingLeft = await visibleRankingsForComparison(db, args.viewerId, args.viewerId);
  const rankingRight = await visibleRankingsForComparison(db, args.targetUserId, args.viewerId);
  const ranking = rankingSimilarity(rankingLeft, rankingRight);
  const finalScore = scaleSimilarityScore(Math.min(1, baseScore * 0.85 + ranking.score * 0.15));
  const topicOverlapIds = overlappingWeights(viewerVectors.topicVector, targetVectors.topicVector, "topic:")
    .slice(0, 5)
    .map((entry) => entry.key.replace(/^topic:/, ""));
  const sourceOverlapIds = overlappingWeights(viewerVectors.sourceVector, targetVectors.sourceVector, "source:")
    .slice(0, 5)
    .map((entry) => entry.key.replace(/^source:/, ""));
  const contentTypeOverlapIds = overlappingWeights(viewerVectors.contentTypeVector, targetVectors.contentTypeVector, "type:")
    .slice(0, 5)
    .map((entry) => entry.key.replace(/^type:/, ""));

  const [sharedTopics, sharedSources, sharedContentTypes] = await Promise.all([
    namesForIds(db, topicOverlapIds, "topic"),
    namesForIds(db, sourceOverlapIds, "contentSource"),
    namesForIds(db, contentTypeOverlapIds, "contentType"),
  ]);

  const explanation = {
    sharedTopics,
    sharedSources,
    sharedContentTypes,
    rankingOverlap: ranking.overlaps,
  };

  const persisted = await db.comparisonCache.upsert({
    where: { comparisonKey: cacheKey },
    update: {
      leftVersion: viewer.tasteProfileVersion,
      rightVersion: target.tasteProfileVersion,
      score: finalScore,
      explanation,
      computedAt: new Date(),
    },
    create: {
      comparisonKey: cacheKey,
      leftUserId: args.viewerId,
      rightUserId: args.targetUserId,
      leftVersion: viewer.tasteProfileVersion,
      rightVersion: target.tasteProfileVersion,
      score: finalScore,
      explanation,
    },
  });

  return persisted;
}

export async function suggestSimilarUsers(args: {
  userId: string;
  limit?: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const limit = args.limit ?? 5;
  const candidates = await db.user.findMany({
    where: {
      id: { not: args.userId },
      profile: {
        isOnboarded: true,
      },
    },
    select: {
      id: true,
      profile: {
        select: {
          handle: true,
          displayName: true,
        },
      },
    },
    take: 50,
  });

  const results = [] as Array<{ id: string; handle: string; displayName: string; score: number; explanation: unknown }>;

  for (const candidate of candidates) {
    if (!candidate.profile) {
      continue;
    }

    const comparison = await compareUsers({
      viewerId: args.userId,
      targetUserId: candidate.id,
      db,
    });

    results.push({
      id: candidate.id,
      handle: candidate.profile.handle,
      displayName: candidate.profile.displayName,
      score: comparison.score,
      explanation: comparison.explanation,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
