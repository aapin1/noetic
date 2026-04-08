import { Visibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { rankTextMatch } from "@/server/search-ranking";
import type { DbClient } from "@/server/db";

export async function searchEverything(args: {
  query: string;
  limit?: number;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const limit = args.limit ?? 10;
  const query = args.query.trim();

  const [users, contentItems, topics] = await Promise.all([
    db.profile.findMany({
      where: {
        OR: [
          { handle: { contains: query, mode: "insensitive" } },
          { displayName: { contains: query, mode: "insensitive" } },
        ],
        isOnboarded: true,
      },
      take: limit * 2,
      include: {
        user: {
          select: {
            id: true,
          },
        },
      },
    }),
    db.contentItem.findMany({
      where: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { siteName: { contains: query, mode: "insensitive" } },
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
        _count: {
          select: { logs: true, rankingItems: true, saves: true },
        },
      },
      take: limit * 2,
    }),
    db.topic.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { slug: { contains: query, mode: "insensitive" } },
        ],
      },
      take: limit * 2,
      include: {
        _count: {
          select: { userTopics: true, contentTags: true, logTags: true },
        },
      },
    }),
  ]);

  return {
    users: users
      .map((profile) => ({
        id: profile.user.id,
        handle: profile.handle,
        displayName: profile.displayName,
        score: Math.max(rankTextMatch(profile.handle, query), rankTextMatch(profile.displayName, query)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
    contentItems: contentItems
      .map((item) => ({
        id: item.id,
        title: item.title,
        sourceName: item.source?.name ?? null,
        contentType: item.contentType?.name ?? null,
        score:
          rankTextMatch(item.title, query) +
          rankTextMatch(item.siteName ?? "", query) +
          item._count.logs +
          item._count.rankingItems +
          item._count.saves,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
    topics: topics
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        slug: topic.slug,
        score: rankTextMatch(topic.name, query) + topic._count.userTopics + topic._count.contentTags + topic._count.logTags,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit),
  };
}
