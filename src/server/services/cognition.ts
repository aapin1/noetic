import {
  CaptureKind,
  CognitiveEventType,
  InsightStyle,
  type Prisma,
} from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient, RootDbClient } from "@/server/db";
import { ingestOrStubUrl } from "@/server/services/content";
import {
  cosine,
  extractKeyIdea,
  extractiveSummary,
  jaccard,
  polarity,
  termFrequency,
  tokenize,
  topTerms,
  type TermVector,
} from "@/server/cognition/terms";
import { classifyTopics, type ClassifiedTopic } from "@/server/cognition/topics";
import {
  classifyEdge,
  draftInsights,
  type Neighbor,
  type TopicCount,
  type TrajectoryShift,
} from "@/server/cognition/insights";
import { generateRecommendations, polishInsights, type Recommendation } from "@/server/cognition/llm";
import { applyTopicWeights, incrementTasteProfileVersion } from "@/server/services/activity";

const NEIGHBOR_LIMIT = 6;
const NEIGHBOR_SCAN = 80;
const NEIGHBOR_THRESHOLD = 0.08;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PRIOR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type CapturePayload = {
  userId: string;
  kind: CaptureKind;
  url?: string;
  text?: string;
  caption?: string;
  mediaUrl?: string;
  reaction?: string;
  topicHints?: string[];
  db?: RootDbClient;
};

type CapturedItemSummary = {
  id: string;
  title: string;
  summary: string | null;
  keyIdea: string | null;
  capturedAt: Date;
  reaction: string | null;
  kind: CaptureKind;
  topics: { topicId: string; name: string; slug: string; weight: number }[];
  contentItem: {
    id: string;
    title: string;
    canonicalUrl: string | null;
    sourceName: string | null;
    contentType: string | null;
    imageUrl: string | null;
    authorName: string | null;
  } | null;
  rawText: string | null;
  caption: string | null;
  mediaUrl: string | null;
};

type CaptureWithRelations = Prisma.CapturedItemGetPayload<{
  include: {
    contentItem: {
      include: {
        source: true;
        contentType: true;
      };
    };
    topics: {
      include: { topic: true };
    };
  };
}>;

function captureTitle(item: CaptureWithRelations): string {
  if (item.contentItem?.title) {
    return item.contentItem.title;
  }

  const text = item.rawText ?? item.caption ?? "";
  const trimmed = text.trim();

  if (!trimmed) {
    return item.kind === CaptureKind.IMAGE ? "Untitled image" : "Untitled capture";
  }

  if (trimmed.length <= 80) {
    return trimmed;
  }

  return `${trimmed.slice(0, 77).trimEnd()}…`;
}

function serializeCapturedItem(item: CaptureWithRelations): CapturedItemSummary {
  return {
    id: item.id,
    title: captureTitle(item),
    summary: item.summary,
    keyIdea: item.keyIdea,
    capturedAt: item.capturedAt,
    reaction: item.reaction,
    kind: item.kind,
    topics: item.topics.map((row) => ({
      topicId: row.topicId,
      name: row.topic.name,
      slug: row.topic.slug,
      weight: row.weight,
    })),
    contentItem: item.contentItem
      ? {
        id: item.contentItem.id,
        title: item.contentItem.title,
        canonicalUrl: item.contentItem.canonicalUrl,
        sourceName: item.contentItem.source?.name ?? item.contentItem.siteName ?? null,
        contentType: item.contentItem.contentType?.name ?? null,
        imageUrl: item.contentItem.imageUrl ?? null,
        authorName: item.contentItem.authorName ?? null,
      }
      : null,
    rawText: item.rawText,
    caption: item.caption,
    mediaUrl: item.mediaUrl,
  };
}

async function ensureUserPreference(db: DbClient, userId: string): Promise<InsightStyle> {
  const existing = await db.userPreference.findUnique({
    where: { userId },
    select: { insightStyle: true },
  });

  if (existing) {
    return existing.insightStyle;
  }

  const created = await db.userPreference.create({
    data: { userId },
    select: { insightStyle: true },
  });

  return created.insightStyle;
}

function sourceTokens(args: {
  rawText?: string;
  caption?: string;
  reaction?: string;
  contentTitle?: string;
  contentDescription?: string;
}): { tokens: string[]; combinedText: string } {
  const parts = [
    args.contentTitle,
    args.contentDescription,
    args.rawText,
    args.caption,
    args.reaction,
  ].filter((part): part is string => Boolean(part));

  const combinedText = parts.join("\n").trim();
  return { tokens: tokenize(combinedText), combinedText };
}

async function loadPriorCaptures(args: {
  db: DbClient;
  userId: string;
  excludeId?: string;
  limit: number;
}) {
  return args.db.capturedItem.findMany({
    where: {
      userId: args.userId,
      id: args.excludeId ? { not: args.excludeId } : undefined,
    },
    orderBy: { capturedAt: "desc" },
    take: args.limit,
    include: {
      contentItem: {
        include: { source: true },
      },
      topics: { select: { topicId: true } },
    },
  });
}

function computeTopicCounts(
  priors: { topics: { topicId: string }[] }[],
  topicMap: Map<string, ClassifiedTopic>,
): TopicCount[] {
  const counts = new Map<string, number>();

  for (const prior of priors) {
    for (const row of prior.topics) {
      counts.set(row.topicId, (counts.get(row.topicId) ?? 0) + 1);
    }
  }

  return Array.from(topicMap.values())
    .map((topic) => ({
      topicId: topic.topicId,
      name: topic.name,
      count: (counts.get(topic.topicId) ?? 0) + 1,
    }))
    .sort((a, b) => b.count - a.count);
}

function computeTrajectory(
  priors: { capturedAt: Date; topics: { topicId: string }[] }[],
  topicMap: Map<string, ClassifiedTopic>,
): TrajectoryShift | null {
  const now = Date.now();
  const recentCutoff = now - RECENT_WINDOW_MS;
  const priorCutoff = now - PRIOR_WINDOW_MS;

  let bestShift: TrajectoryShift | null = null;

  for (const topic of topicMap.values()) {
    let recent = 0;
    let prior = 0;

    for (const item of priors) {
      const inWindow = item.capturedAt.getTime();

      if (!item.topics.some((row) => row.topicId === topic.topicId)) {
        continue;
      }

      if (inWindow >= recentCutoff) {
        recent += 1;
      } else if (inWindow >= priorCutoff) {
        prior += 1;
      }
    }

    const delta = recent - prior;

    if (Math.abs(delta) >= 1 && (!bestShift || Math.abs(delta) > Math.abs(bestShift.delta))) {
      bestShift = {
        topicId: topic.topicId,
        name: topic.name,
        recentCount: recent,
        priorCount: prior,
        delta,
      };
    }
  }

  return bestShift;
}

async function computeNeighbors(args: {
  db: DbClient;
  userId: string;
  itemTokens: string[];
  itemTermVector: TermVector;
  itemTopicIds: Set<string>;
  itemPolarity: { negation: number; affirmation: number };
  excludeCaptureId?: string;
}): Promise<{
  neighbors: Neighbor[];
  topicCounts: { topicId: string; count: number }[];
  priorCount: number;
  rawPriors: Awaited<ReturnType<typeof loadPriorCaptures>>;
}> {
  const priors = await loadPriorCaptures({
    db: args.db,
    userId: args.userId,
    excludeId: args.excludeCaptureId,
    limit: NEIGHBOR_SCAN,
  });

  const neighbors: Neighbor[] = [];

  for (const prior of priors) {
    const priorText = [
      prior.contentItem?.title,
      prior.contentItem?.description,
      prior.rawText,
      prior.caption,
      prior.reaction,
    ].filter(Boolean).join("\n");

    const priorTokens = tokenize(priorText);

    if (priorTokens.length === 0) {
      continue;
    }

    const priorVector = termFrequency(priorTokens);
    const similarity = cosine(args.itemTermVector, priorVector);
    const priorTopicIds = new Set(prior.topics.map((row) => row.topicId));
    const topicJaccardScore = jaccard(args.itemTopicIds, priorTopicIds);
    const priorPolarity = polarity(priorTokens);
    const polarityDelta = Math.abs(priorPolarity.negation - args.itemPolarity.negation)
      + Math.abs(priorPolarity.affirmation - args.itemPolarity.affirmation);

    if (similarity < NEIGHBOR_THRESHOLD && topicJaccardScore < 0.15) {
      continue;
    }

    const edgeType = classifyEdge({
      cosine: similarity,
      topicJaccard: topicJaccardScore,
      polarityDelta,
    });

    if (!edgeType) {
      continue;
    }

    neighbors.push({
      capturedItemId: prior.id,
      title: prior.contentItem?.title ?? prior.rawText?.slice(0, 60) ?? "Untitled capture",
      similarity,
      topicJaccard: topicJaccardScore,
      edgeType,
      capturedAt: prior.capturedAt,
    });
  }

  neighbors.sort((a, b) => b.similarity * 0.7 + b.topicJaccard * 0.3 - (a.similarity * 0.7 + a.topicJaccard * 0.3));

  const topicCounts = new Map<string, number>();

  for (const prior of priors) {
    for (const row of prior.topics) {
      topicCounts.set(row.topicId, (topicCounts.get(row.topicId) ?? 0) + 1);
    }
  }

  return {
    neighbors: neighbors.slice(0, NEIGHBOR_LIMIT),
    topicCounts: Array.from(topicCounts.entries()).map(([topicId, count]) => ({ topicId, count })),
    priorCount: priors.length,
    rawPriors: priors,
  };
}

export function computeThreadContext(
  topicCounts: TopicCount[],
): { topicName: string; captureCount: number } | null {
  if (topicCounts.length === 0 || topicCounts[0].count < 2) return null;
  return { topicName: topicCounts[0].name, captureCount: topicCounts[0].count };
}

export async function captureItem(payload: CapturePayload): Promise<CapturedItemSummary & {
  insights: { id: string; type: string; headline: string; body: string; strength: number; evidence: unknown }[];
  related: CapturedItemSummary[];
  edges: { fromItemId: string; toItemId: string; type: string; weight: number }[];
  threadContext: { topicName: string; captureCount: number } | null;
  recommendations: Recommendation[];
}> {
  const db = payload.db ?? prisma;

  if (payload.kind === CaptureKind.LINK && !payload.url) {
    throw new AppError("INVALID_CAPTURE", "URL is required for link captures", 422);
  }

  if ((payload.kind === CaptureKind.TEXT || payload.kind === CaptureKind.QUOTE) && !payload.text) {
    throw new AppError("INVALID_CAPTURE", "Text is required for text captures", 422);
  }

  if (payload.kind === CaptureKind.IMAGE && !payload.mediaUrl && !payload.caption && !payload.text) {
    throw new AppError("INVALID_CAPTURE", "Image captures need a media URL or a caption", 422);
  }

  let contentItemId: string | undefined;
  let contentTitle: string | undefined;
  let contentDescription: string | undefined;

  if (payload.kind === CaptureKind.LINK && payload.url) {
    const resolved = await ingestOrStubUrl(payload.url, db);
    contentItemId = resolved.contentItemId;
    contentTitle = resolved.contentTitle;
    contentDescription = resolved.contentDescription;
  }

  let { tokens, combinedText } = sourceTokens({
    rawText: payload.text,
    caption: payload.caption,
    reaction: payload.reaction,
    contentTitle,
    contentDescription,
  });

  if (tokens.length === 0 && payload.kind === CaptureKind.IMAGE && (payload.mediaUrl || payload.caption || payload.reaction)) {
    const fallback = [payload.caption, payload.reaction, "Visual capture"].filter(Boolean).join("\n");
    const retokenized = sourceTokens({ rawText: fallback });
    tokens = retokenized.tokens;
    combinedText = retokenized.combinedText;
  }

  if (tokens.length === 0) {
    throw new AppError("EMPTY_CAPTURE", "Capture is empty after parsing.", 422);
  }

  const termVector = termFrequency(tokens);
  const itemPolarity = polarity(tokens);
  const summary = extractiveSummary(combinedText, 2);
  const keyIdea = extractKeyIdea(combinedText);

  const [classified, insightStyle] = await Promise.all([
    classifyTopics({
      db,
      userId: payload.userId,
      tokens,
      hints: payload.topicHints,
      title: contentTitle,
      description: contentDescription,
      combinedText,
    }),
    ensureUserPreference(db, payload.userId),
  ]);

  const topicIdSet = new Set(classified.map((topic) => topic.topicId));
  const neighborInfo = await computeNeighbors({
    db,
    userId: payload.userId,
    itemTokens: tokens,
    itemTermVector: termVector,
    itemTopicIds: topicIdSet,
    itemPolarity,
  });

  const isFirstCapture = neighborInfo.priorCount === 0;
  const topicMap = new Map<string, ClassifiedTopic>(
    classified.map((topic) => [topic.topicId, topic]),
  );
  const topicCounts = computeTopicCounts(neighborInfo.rawPriors, topicMap);
  const trajectory = computeTrajectory(neighborInfo.rawPriors, topicMap);

  const fallbackText = (payload.text ?? payload.caption ?? "").slice(0, 80);
  const itemTitle = contentTitle ?? (fallbackText.length > 0 ? fallbackText : "Untitled capture");
  const threadContext = computeThreadContext(topicCounts);

  const drafts = draftInsights({
    style: insightStyle,
    itemTitle,
    topicNames: classified.map((topic) => topic.name),
    topNeighbors: neighborInfo.neighbors,
    topicCounts,
    shift: trajectory,
    isFirstCapture,
  });

  const polishedDrafts = await polishInsights({
    style: insightStyle,
    itemTitle,
    contentText: combinedText,
    topicNames: classified.map((topic) => topic.name),
    neighborContext: neighborInfo.neighbors.map((n) => ({
      title: n.title,
      edgeType: n.edgeType,
    })),
    drafts,
  });

  const [txResult, recommendations] = await Promise.all([
    prisma.$transaction(async (tx: DbClient) => {
    const created = await tx.capturedItem.create({
      data: {
        userId: payload.userId,
        kind: payload.kind,
        contentItemId,
        rawText: payload.text ?? null,
        caption: payload.caption ?? null,
        mediaUrl: payload.mediaUrl ?? null,
        reaction: payload.reaction ?? null,
        summary: summary || null,
        keyIdea: keyIdea || null,
        terms: topTerms(termVector, 24),
      },
    });

    if (classified.length > 0) {
      await tx.capturedItemTopic.createMany({
        data: classified.map((topic) => ({
          capturedItemId: created.id,
          topicId: topic.topicId,
          weight: topic.score,
        })),
        skipDuplicates: true,
      });

      await applyTopicWeights({
        db: tx,
        userId: payload.userId,
        topicIds: classified.map((topic) => topic.topicId),
        increment: 1,
      });
    }

    const insightRows = polishedDrafts.length > 0
      ? await Promise.all(polishedDrafts.map((draft) =>
          tx.insight.create({
            data: {
              userId: payload.userId,
              capturedItemId: created.id,
              type: draft.type,
              headline: draft.headline,
              body: draft.body,
              evidence: draft.evidence as Prisma.InputJsonValue,
              strength: draft.strength,
            },
          }),
        ))
      : [];

    if (neighborInfo.neighbors.length > 0) {
      await tx.memoryEdge.createMany({
        data: neighborInfo.neighbors.map((neighbor) => ({
          userId: payload.userId,
          fromItemId: created.id,
          toItemId: neighbor.capturedItemId,
          type: neighbor.edgeType,
          weight: Number(neighbor.similarity.toFixed(4)),
        })),
        skipDuplicates: true,
      });
    }

    await tx.cognitiveEvent.create({
      data: {
        userId: payload.userId,
        capturedItemId: created.id,
        type: CognitiveEventType.CAPTURED,
        payload: {
          kind: payload.kind,
          topicIds: classified.map((topic) => topic.topicId),
          neighborCount: neighborInfo.neighbors.length,
        } as Prisma.InputJsonValue,
      },
    });

    if (trajectory && Math.abs(trajectory.delta) >= 2) {
      await tx.cognitiveEvent.create({
        data: {
          userId: payload.userId,
          capturedItemId: created.id,
          type: CognitiveEventType.TOPIC_SHIFT,
          payload: trajectory as unknown as Prisma.InputJsonValue,
        },
      });
    }

    if (neighborInfo.neighbors.some((neighbor) => neighbor.edgeType === "CONTRADICTS")) {
      await tx.cognitiveEvent.create({
        data: {
          userId: payload.userId,
          capturedItemId: created.id,
          type: CognitiveEventType.CONTRADICTION_DETECTED,
          payload: { neighborCount: neighborInfo.neighbors.length } as Prisma.InputJsonValue,
        },
      });
    }

    if (isFirstCapture) {
      await tx.cognitiveEvent.create({
        data: {
          userId: payload.userId,
          capturedItemId: created.id,
          type: CognitiveEventType.NOVELTY_DETECTED,
          payload: {} as Prisma.InputJsonValue,
        },
      });
    }

    await incrementTasteProfileVersion(tx, payload.userId);

    const fullItem = await tx.capturedItem.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        contentItem: {
          include: { source: true, contentType: true },
        },
        topics: { include: { topic: true } },
      },
    });

    const relatedRecords = neighborInfo.neighbors.length > 0
      ? await tx.capturedItem.findMany({
        where: {
          id: { in: neighborInfo.neighbors.map((neighbor) => neighbor.capturedItemId) },
        },
        include: {
          contentItem: { include: { source: true, contentType: true } },
          topics: { include: { topic: true } },
        },
      })
      : [];

    const orderMap = new Map(
      neighborInfo.neighbors.map((neighbor, index) => [neighbor.capturedItemId, index]),
    );
    const related = relatedRecords
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0))
      .map(serializeCapturedItem);

    return {
      ...serializeCapturedItem(fullItem),
      insights: insightRows.map((row) => ({
        id: row.id,
        type: row.type,
        headline: row.headline,
        body: row.body,
        strength: row.strength,
        evidence: row.evidence,
      })),
      related,
      edges: neighborInfo.neighbors.map((neighbor) => ({
        fromItemId: created.id,
        toItemId: neighbor.capturedItemId,
        type: neighbor.edgeType,
        weight: Number(neighbor.similarity.toFixed(4)),
      })),
    };
  }),
    generateRecommendations({
      itemTitle,
      contentText: combinedText,
      topicNames: classified.map((t) => t.name),
      threadContext: threadContext ?? undefined,
      neighborTitles: neighborInfo.neighbors.slice(0, 3).map((n) => n.title),
    }),
  ]);

  return { ...txResult, threadContext, recommendations };
}

export async function getCapture(args: { userId: string; capturedItemId: string; db?: DbClient }) {
  const db = args.db ?? prisma;
  const item = await db.capturedItem.findUnique({
    where: { id: args.capturedItemId },
    include: {
      contentItem: { include: { source: true, contentType: true } },
      topics: { include: { topic: true } },
      insights: { orderBy: { createdAt: "asc" } },
      edgesFrom: {
        include: {
          toItem: {
            include: {
              contentItem: { include: { source: true, contentType: true } },
              topics: { include: { topic: true } },
            },
          },
        },
        orderBy: { weight: "desc" },
      },
    },
  });

  if (!item || item.userId !== args.userId) {
    throw new AppError("CAPTURE_NOT_FOUND", "Capture not found", 404);
  }

  return {
    ...serializeCapturedItem(item),
    insights: item.insights.map((row) => ({
      id: row.id,
      type: row.type,
      headline: row.headline,
      body: row.body,
      strength: row.strength,
      evidence: row.evidence,
    })),
    related: item.edgesFrom.map((edge) => ({
      ...serializeCapturedItem(edge.toItem),
      edgeType: edge.type,
      edgeWeight: edge.weight,
    })),
  };
}

export async function listCaptures(args: { userId: string; limit?: number; db?: DbClient }) {
  const db = args.db ?? prisma;
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 80);
  const items = await db.capturedItem.findMany({
    where: { userId: args.userId },
    orderBy: { capturedAt: "desc" },
    take: limit,
    include: {
      contentItem: { include: { source: true, contentType: true } },
      topics: { include: { topic: true } },
      insights: {
        orderBy: { strength: "desc" },
        take: 1,
      },
    },
  });

  return items.map((item) => ({
    ...serializeCapturedItem(item),
    leadInsight: item.insights[0]
      ? {
        id: item.insights[0].id,
        type: item.insights[0].type,
        headline: item.insights[0].headline,
      }
      : null,
  }));
}
