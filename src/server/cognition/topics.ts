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
    const { domain, topics: llmTopics } = await extractSemanticTopics({
      title: args.title,
      combinedText: args.combinedText ?? args.description,
    });

    if (domain || llmTopics.length > 0) {
      // Order matters: the coarse domain comes first so the map anchors every
      // node to its broad field (keeping similar captures in one region), then
      // specific topics, then any explicit caller hints. Topics come purely
      // from the content — they are NOT restricted to the user's chosen
      // interests. upsertTopics creates Topic records for unseen names.
      const allNames = [
        ...(domain ? [domain] : []),
        ...llmTopics,
        ...hintNames,
      ];
      const records = await upsertTopics(args.db, allNames);

      const seen = new Set<string>();
      const unique: { id: string; name: string; slug: string }[] = [];
      for (const r of records) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          unique.push(r);
        }
      }

      // Domain anchor scores 1.0; later topics decrease so the domain always
      // outranks specifics when the layout picks a cluster anchor.
      return unique.slice(0, 8).map((r, idx) => {
        const score = idx === 0 ? 1.0 : Math.max(0.65, 0.9 - (idx - 1) * 0.04);
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
      return { topic, matches, size: topic.keywords.size };
    })
    // A single coincidental token must NOT classify a capture: a broad
    // one-word topic like "film" {film} previously scored matches/size = 1/1 =
    // 1.0 off one stray "film" token and beat genuinely-relevant topics.
    // Require either ≥2 keyword hits, or a single hit against a specific
    // (multi-keyword) topic. Rank by absolute hit count, not by hit ratio.
    .filter((entry) => entry.matches >= 2 || (entry.matches >= 1 && entry.size >= 4))
    // Normalize hit count into (0,1] (monotonic in matches) to keep the weight
    // contract consistent with the LLM path: 2→0.67, 3→0.75, 4→0.80, …
    .map((entry) => ({ topic: entry.topic, score: entry.matches / (entry.matches + 1) }))
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
