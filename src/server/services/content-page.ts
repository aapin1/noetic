import { Visibility } from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";

export async function getContentPage(args: {
  contentItemId: string;
  viewerId?: string | null;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const contentItem = await db.contentItem.findUnique({
    where: { id: args.contentItemId },
    include: {
      source: true,
      contentType: true,
      topics: {
        include: { topic: true },
      },
    },
  });

  if (!contentItem) {
    throw new AppError("CONTENT_NOT_FOUND", "Content item not found", 404);
  }

  const [publicReviews, userRankingPositions, similarContent, reviewers, shareMetadata] = await Promise.all([
    db.review.findMany({
      where: {
        logEntry: {
          contentItemId: args.contentItemId,
        },
        visibility: Visibility.PUBLIC,
      },
      include: {
        author: {
          include: { profile: true },
        },
        likes: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    args.viewerId
      ? db.rankedItem.findMany({
          where: {
            contentItemId: args.contentItemId,
            rankingList: {
              userId: args.viewerId,
            },
          },
          include: {
            rankingList: true,
          },
        })
      : [],
    db.contentItem.findMany({
      where: {
        id: { not: args.contentItemId },
        OR: [
          { sourceId: contentItem.sourceId ?? undefined },
          { contentTypeId: contentItem.contentTypeId ?? undefined },
          {
            topics: {
              some: {
                topicId: {
                  in: contentItem.topics.map((topic) => topic.topicId),
                },
              },
            },
          },
        ],
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
      },
      take: 8,
    }),
    db.review.findMany({
      where: {
        logEntry: {
          contentItemId: args.contentItemId,
        },
        visibility: Visibility.PUBLIC,
      },
      include: {
        author: {
          include: { profile: true },
        },
      },
      take: 10,
    }),
    db.shareEvent.findMany({
      where: { contentItemId: args.contentItemId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return {
    contentItem,
    publicReviews,
    userRankingPositions,
    similarContent,
    reviewers: reviewers.map((review) => ({
      userId: review.authorId,
      handle: review.author.profile?.handle,
      displayName: review.author.profile?.displayName,
    })),
    shareMetadata,
  };
}
