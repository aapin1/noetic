import type { DbClient } from "@/server/db";
import { tokenize } from "@/server/cognition/terms";
import { extractSemanticTopics } from "@/server/cognition/llm";
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
  /** Article/content title — used for LLM topic extraction */
  title?: string;
  /** Extracted description or metadata description */
  description?: string;
  /** Full combined text passed to tokenizer — used for LLM extraction */
  combinedText?: string;
}): Promise<ClassifiedTopic[]> {
  const hintNames = (args.hints ?? []).map((h) => h.trim()).filter(Boolean);

  // ── LLM path ──────────────────────────────────────────────────────────────
  // Use the LLM when we have enough context (title or ≥40 chars of combined text).
  const hasContext =
    (args.title && args.title.trim().length >= 4) ||
    (args.combinedText && args.combinedText.trim().length >= 40);

  if (hasContext) {
    const llmTopics = await extractSemanticTopics({
      title: args.title,
      combinedText: args.combinedText ?? args.description,
    });

    if (llmTopics.length > 0) {
      // Merge with explicit caller hints (caller hints always included first)
      const allNames = [...hintNames, ...llmTopics];
      // Upsert: creates new Topic records for previously-unseen topic names
      const records = await upsertTopics(args.db, allNames);

      const seen = new Set<string>();
      const unique: { id: string; name: string; slug: string }[] = [];
      for (const r of records) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          unique.push(r);
        }
      }

      // Hints get score 1.0, LLM topics get decreasing scores from 0.92
      const hintSet = new Set(
        hintNames.map((n) => n.trim().toLowerCase()),
      );

      let llmIdx = 0;
      return unique.slice(0, 8).map((r) => {
        const isHint = hintSet.has(r.name.toLowerCase());
        const score = isHint ? 1.0 : Math.max(0.65, 0.92 - llmIdx++ * 0.04);
        return { topicId: r.id, name: r.name, slug: r.slug, score };
      });
    }
  }

  // ── Keyword fallback ───────────────────────────────────────────────────────
  const max = args.maxTopics ?? 6;
  const tokenSet = new Set(args.tokens);
  const candidateTopics = await loadTopicsForUser(args.db, args.userId);

  const scored = candidateTopics
    .map((topic) => {
      let matches = 0;
      for (const keyword of topic.keywords) {
        if (tokenSet.has(keyword)) matches += 1;
      }
      const denominator = Math.max(topic.keywords.size, 1);
      return { topic, score: matches / denominator };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  let hintRecords: { id: string; name: string; slug: string }[] = [];
  if (hintNames.length > 0) {
    hintRecords = await upsertTopics(args.db, hintNames);
  }

  const topicMap = new Map<string, ClassifiedTopic>();

  for (const hint of hintRecords) {
    topicMap.set(hint.id, { topicId: hint.id, name: hint.name, slug: hint.slug, score: 1 });
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
    if (topicMap.size >= max) break;
  }

  return Array.from(topicMap.values()).slice(0, max);
}
