import type { DbClient } from "@/server/db";
import { tokenize } from "@/server/cognition/terms";
import { extractSemanticTopics } from "@/server/cognition/llm";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import { upsertTopics, normalizeTopicName } from "@/server/topics";

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

/** Rows of (item, topic) scanned to learn which general field each specific
 * label lives under. Bounded so classification cost stays flat as the map grows. */
const EXISTING_TOPIC_SCAN = 1000;
/** Labels offered per general field. Stops one dominant field from crowding
 * every other field out of the classifier's prompt budget. */
const LABELS_PER_GENERAL = 8;

/**
 * The user's specific sub-topics, grouped by the general field they actually
 * live under (learned from co-occurrence on the same capture). The classifier
 * needs the attribution, not just the labels: a bare list lets it file an LLM
 * article under a biology field's "ai in biology" purely on word overlap.
 * Fields are ordered by how much the user uses them, labels by how often each
 * is used, so the prompt's fixed budget is spent on the buckets most likely to
 * be the right home.
 */
async function loadExistingTopicsByGeneral(
  db: DbClient,
  userId: string,
): Promise<Record<string, string[]>> {
  const rows = await db.capturedItemTopic.findMany({
    where: { capturedItem: { userId } },
    orderBy: { capturedItem: { capturedAt: "desc" } },
    take: EXISTING_TOPIC_SCAN,
    select: { capturedItemId: true, topic: { select: { name: true } } },
  });

  const namesByItem = new Map<string, string[]>();
  for (const row of rows) {
    const names = namesByItem.get(row.capturedItemId);
    if (names) names.push(row.topic.name);
    else namesByItem.set(row.capturedItemId, [row.topic.name]);
  }

  const counts = new Map<string, Map<string, number>>();
  for (const names of namesByItem.values()) {
    const generals = names.filter((name) => isGeneralTopic(name));
    const specifics = names.filter((name) => !isGeneralTopic(name));
    for (const general of generals) {
      let bucket = counts.get(general);
      if (!bucket) {
        bucket = new Map();
        counts.set(general, bucket);
      }
      for (const specific of specifics) {
        bucket.set(specific, (bucket.get(specific) ?? 0) + 1);
      }
    }
  }

  const ranked = Array.from(counts.entries())
    .map(([general, bucket]) => {
      const labels = Array.from(bucket.entries()).sort((a, b) => b[1] - a[1]);
      const total = labels.reduce((sum, [, count]) => sum + count, 0);
      return { general, total, labels: labels.slice(0, LABELS_PER_GENERAL).map(([name]) => name) };
    })
    .filter((entry) => entry.labels.length > 0)
    .sort((a, b) => b.total - a.total);

  return Object.fromEntries(ranked.map((entry) => [entry.general, entry.labels]));
}

export type TopicKind = "general" | "specific";

export type ClassifiedTopic = {
  topicId: string;
  name: string;
  slug: string;
  score: number;
  /** general = coarse onboarding-style field; specific = fine-grained label. */
  kind: TopicKind;
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
    // Offer the user's existing specific sub-topics to the classifier so
    // content that fits an established bucket reuses it instead of spawning a
    // wording variant ("stoic philosophy" next to "stoicism") — but attributed
    // to their fields, so the classifier can only reuse a label from the field
    // it actually picked.
    const existingTopicsByGeneral = await loadExistingTopicsByGeneral(args.db, args.userId);

    const { classifications } = await extractSemanticTopics({
      title: args.title,
      combinedText: args.combinedText ?? args.description,
      existingTopicsByGeneral,
    });

    if (classifications.length > 0) {
      // Build the ordered (name, kind, score) plan. General fields come first so
      // the map anchors every node to its broad field (keeping similar captures
      // in one region); the primary general leads at 1.0. Specifics follow at a
      // lower band, then any explicit caller hints. Topics come purely from the
      // content — they are NOT restricted to the user's chosen interests.
      const generals = classifications.map((c) => c.general);
      const specifics = classifications.map((c) => c.specific).filter(Boolean);

      const plan: { name: string; kind: TopicKind; score: number }[] = [
        ...generals.map((name, idx) => ({
          name,
          kind: "general" as const,
          score: idx === 0 ? 1.0 : Math.max(0.85, 0.92 - (idx - 1) * 0.04),
        })),
        ...specifics.map((name, idx) => ({
          name,
          kind: "specific" as const,
          score: Math.max(0.6, 0.75 - idx * 0.05),
        })),
        ...hintNames.map((name) => ({ name, kind: "specific" as const, score: 0.6 })),
      ];

      // upsertTopics normalizes + dedupes its input, so match returned records
      // back to the plan by normalized name (not array index). Keep the first
      // (highest-priority) plan entry for each name; dedup by resulting id.
      const planByName = new Map<string, { kind: TopicKind; score: number }>();
      for (const p of plan) {
        const key = normalizeTopicName(p.name);
        if (!planByName.has(key)) planByName.set(key, { kind: p.kind, score: p.score });
      }

      const records = await upsertTopics(args.db, plan.map((p) => p.name));
      const byId = new Map<string, ClassifiedTopic>();
      for (const r of records) {
        if (byId.has(r.id)) continue;
        const meta = planByName.get(normalizeTopicName(r.name)) ?? { kind: "specific" as const, score: 0.6 };
        byId.set(r.id, { topicId: r.id, name: r.name, slug: r.slug, score: meta.score, kind: meta.kind });
      }

      // Preserve plan priority order (generals first, by score) so topics[0] is
      // the primary general anchor the map clusters on.
      const ordered = Array.from(byId.values()).sort((a, b) => b.score - a.score);
      return await ensureGeneral(args.db, ordered);
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
    topicMap.set(hint.id, {
      topicId: hint.id,
      name: hint.name,
      slug: hint.slug,
      score: 1,
      kind: isGeneralTopic(hint.name) ? "general" : "specific",
    });
  }

  for (const entry of scored) {
    if (!topicMap.has(entry.topic.id)) {
      topicMap.set(entry.topic.id, {
        topicId: entry.topic.id,
        name: entry.topic.name,
        slug: entry.topic.slug,
        score: entry.score,
        kind: isGeneralTopic(entry.topic.name) ? "general" : "specific",
      });
    }
    if (topicMap.size >= max) break;
  }

  return await ensureGeneral(args.db, Array.from(topicMap.values()).slice(0, max));
}

/**
 * Guarantees every node ends up with at least one GENERAL topic. The LLM path
 * always yields one, but the keyword fallback (and total-LLM-failure) can come
 * back with only specifics or nothing at all. In that case we can't know what
 * the node is actually about, so it goes in a neutral "general" bucket rather
 * than being guessed into the user's dominant existing field — a genuinely
 * unrelated capture must never be silently mislabeled as the user's biggest
 * topic just because nothing else could be determined.
 */
async function ensureGeneral(
  db: DbClient,
  topics: ClassifiedTopic[],
): Promise<ClassifiedTopic[]> {
  if (topics.some((t) => t.kind === "general")) return topics;

  const [record] = await upsertTopics(db, ["general"]);
  if (!record) return topics;
  const anchor: ClassifiedTopic = { topicId: record.id, name: record.name, slug: record.slug, score: 1, kind: "general" };

  // Anchor leads at 1.0 so the map still has a field to cluster on; demote any
  // existing specifics below it.
  const demoted = topics
    .filter((t) => t.topicId !== anchor.topicId)
    .map((t) => ({ ...t, score: Math.min(t.score, 0.75) }));
  return [anchor, ...demoted];
}
