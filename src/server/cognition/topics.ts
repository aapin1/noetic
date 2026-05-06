import type { DbClient } from "@/server/db";
import { tokenize } from "@/server/cognition/terms";
import { upsertTopics } from "@/server/topics";

type TopicWithKeywords = {
  id: string;
  name: string;
  slug: string;
  keywords: Set<string>;
};

async function loadTopicsForUser(db: DbClient, userId: string, limit = 100): Promise<TopicWithKeywords[]> {
  const userTopics = await db.userTopic.findMany({
    where: { userId },
    orderBy: { weight: "desc" },
    take: limit,
    include: { topic: true },
  });

  const seen = new Set(userTopics.map((row) => row.topicId));
  const fillCount = Math.max(limit - userTopics.length, 0);

  const fill = fillCount > 0
    ? await db.topic.findMany({
      where: { id: { notIn: Array.from(seen) } },
      orderBy: { createdAt: "desc" },
      take: fillCount,
    })
    : [];

  const topics = [
    ...userTopics.map((row) => row.topic),
    ...fill,
  ];

  return topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    slug: topic.slug,
    keywords: new Set([
      ...tokenize(topic.name),
      ...tokenize(topic.description ?? ""),
      ...topic.slug.split("-").filter((part) => part.length >= 3),
    ]),
  }));
}

export type ClassifiedTopic = {
  topicId: string;
  name: string;
  slug: string;
  score: number;
};

export async function classifyTopics(args: {
  db: DbClient;
  userId: string;
  tokens: string[];
  hints?: string[];
  maxTopics?: number;
}): Promise<ClassifiedTopic[]> {
  const max = args.maxTopics ?? 4;
  const tokenSet = new Set(args.tokens);
  const candidateTopics = await loadTopicsForUser(args.db, args.userId);

  const scored = candidateTopics
    .map((topic) => {
      let matches = 0;

      for (const keyword of topic.keywords) {
        if (tokenSet.has(keyword)) {
          matches += 1;
        }
      }

      const denominator = Math.max(topic.keywords.size, 1);
      const score = matches / denominator;
      return { topic, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const hintNames = (args.hints ?? []).map((hint) => hint.trim()).filter(Boolean);
  let hintRecords: { id: string; name: string; slug: string }[] = [];

  if (hintNames.length > 0) {
    hintRecords = await upsertTopics(args.db, hintNames);
  }

  const topicMap = new Map<string, ClassifiedTopic>();

  for (const hint of hintRecords) {
    topicMap.set(hint.id, {
      topicId: hint.id,
      name: hint.name,
      slug: hint.slug,
      score: 1,
    });
  }

  for (const entry of scored) {
    if (!topicMap.has(entry.topic.id)) {
      topicMap.set(entry.topic.id, {
        topicId: entry.topic.id,
        name: entry.topic.name,
        slug: entry.topic.slug,
        score: entry.score,
      });
    }

    if (topicMap.size >= max) {
      break;
    }
  }

  if (topicMap.size === 0) {
    const top = await args.db.userTopic.findMany({
      where: { userId: args.userId },
      orderBy: { weight: "desc" },
      take: max,
      include: { topic: true },
    });

    for (const row of top) {
      topicMap.set(row.topicId, {
        topicId: row.topicId,
        name: row.topic.name,
        slug: row.topic.slug,
        score: 0.05,
      });
    }
  }

  return Array.from(topicMap.values()).slice(0, max);
}
