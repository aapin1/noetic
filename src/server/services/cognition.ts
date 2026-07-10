import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CaptureKind,
  CognitiveEventType,
  InsightStyle,
  type MemoryEdgeType,
  type Prisma,
} from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient, RootDbClient } from "@/server/db";
import { ingestOrStubUrl } from "@/server/services/content";
import {
  cosine,
  jaccard,
  polarity,
  termFrequency,
  tokenize,
  topTerms,
  type TermVector,
} from "@/server/cognition/terms";
import { classifyTopics, type ClassifiedTopic, type TopicKind } from "@/server/cognition/topics";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import {
  classifyEdge,
  classifyEdgeSemantic,
  draftInsights,
  type Neighbor,
  type TopicCount,
  type TrajectoryShift,
} from "@/server/cognition/insights";
import { cosineSim } from "@/server/cognition/layout";
import { describeImage, embedText, generateRecommendations, polishInsights, type Recommendation } from "@/server/cognition/llm";
import { scoreContentConfidence } from "@/server/metadata";
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
  /** The user's own account of what the content was about (capture fail-safe).
   * Treated as ground truth alongside whatever was scraped. */
  userContext?: string;
  topicHints?: string[];
  db?: RootDbClient;
};

export type CapturedItemSummary = {
  id: string;
  title: string;
  summary: string | null;
  keyIdea: string | null;
  capturedAt: Date;
  reaction: string | null;
  userContext: string | null;
  kind: CaptureKind;
  topics: { topicId: string; name: string; slug: string; weight: number; kind: TopicKind }[];
  contentItem: {
    id: string;
    title: string;
    description: string | null;
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

export type CaptureWithRelations = Prisma.CapturedItemGetPayload<{
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

export function serializeCapturedItem(item: CaptureWithRelations): CapturedItemSummary {
  return {
    id: item.id,
    title: captureTitle(item),
    summary: item.summary,
    keyIdea: item.keyIdea,
    capturedAt: item.capturedAt,
    reaction: item.reaction,
    userContext: item.userContext,
    kind: item.kind,
    topics: item.topics.map((row) => ({
      topicId: row.topicId,
      name: row.topic.name,
      slug: row.topic.slug,
      weight: row.weight,
      kind: isGeneralTopic(row.topic.name) ? "general" : "specific",
    })),
    contentItem: item.contentItem
      ? {
        id: item.contentItem.id,
        title: item.contentItem.title,
        description: item.contentItem.description,
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
  userContext?: string;
  contentTitle?: string;
  contentDescription?: string;
  contentBodyText?: string;
}): { tokens: string[]; combinedText: string } {
  const parts = [
    args.contentTitle,
    args.userContext,
    args.contentDescription,
    args.contentBodyText,
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
  itemEmbedding?: number[] | null;
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
  const itemEmbedding = args.itemEmbedding ?? null;

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
    const priorTopicIds = new Set(prior.topics.map((row) => row.topicId));
    const topicJaccardScore = jaccard(args.itemTopicIds, priorTopicIds);
    const priorPolarity = polarity(priorTokens);
    const polarityDelta = Math.abs(priorPolarity.negation - args.itemPolarity.negation)
      + Math.abs(priorPolarity.affirmation - args.itemPolarity.affirmation);

    // Prefer semantic (embedding) similarity; fall back to keyword cosine only
    // when an embedding is unavailable on either side.
    const priorEmbedding = (prior as { embedding?: number[] | null }).embedding ?? null;
    const useEmbedding =
      itemEmbedding !== null && priorEmbedding !== null && priorEmbedding.length > 0;

    let similarity: number;
    let edgeType: ReturnType<typeof classifyEdge>;

    if (useEmbedding) {
      similarity = cosineSim(itemEmbedding, priorEmbedding);
      edgeType = classifyEdgeSemantic({ similarity, polarityDelta, topicJaccard: topicJaccardScore });
    } else {
      similarity = cosine(args.itemTermVector, priorVector);
      if (similarity < NEIGHBOR_THRESHOLD && topicJaccardScore < 0.15) {
        continue;
      }
      edgeType = classifyEdge({ cosine: similarity, topicJaccard: topicJaccardScore, polarityDelta });
    }

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

  neighbors.sort((a, b) => b.similarity - a.similarity);

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

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

/**
 * Loads a capture image as base64 so it can be sent to the vision model.
 * Fetches the stored object by URL, which works for both R2 public URLs
 * (production) and the local dev server serving public/. Falls back to reading
 * local disk directly if the URL points at our capture-uploads dir but the
 * server URL isn't reachable from inside the process.
 */
async function loadImageForVision(mediaUrl: string): Promise<{ base64: string; mimeType: string } | null> {
  const ext = (mediaUrl.split("?")[0].split(".").pop() ?? "").toLowerCase();
  const mimeType = IMAGE_MIME_BY_EXT[ext] ?? "image/jpeg";

  try {
    const res = await fetch(mediaUrl);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 0) return { base64: buffer.toString("base64"), mimeType };
    }
  } catch {
    // fall through to the local-disk fallback below
  }

  try {
    const fname = decodeURIComponent(mediaUrl.split("/").pop()?.split("?")[0] ?? "");
    if (!fname || fname.includes("..") || fname.includes("/")) return null;
    const buffer = await readFile(path.join(process.cwd(), "public", "capture-uploads", fname));
    return { base64: buffer.toString("base64"), mimeType };
  } catch {
    return null;
  }
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
  let contentBodyText: string | undefined;
  // A clean, short "what this is about" line for display — never the full
  // scraped body/transcript. Shown on the insight screen as the AI summary.
  let captureSummary: string | null = null;

  if (payload.kind === CaptureKind.LINK && payload.url) {
    const resolved = await ingestOrStubUrl(payload.url, db);
    contentItemId = resolved.contentItemId;
    contentTitle = resolved.contentTitle;
    contentDescription = resolved.contentDescription;
    contentBodyText = resolved.bodyText;
    // The cleaned excerpt is a 1-2 sentence gist; a bare URL (metadata scrape
    // failed → stub) is not a summary, so skip it and let the user's own
    // account fill in instead.
    captureSummary =
      resolved.contentDescription && !/^https?:\/\//i.test(resolved.contentDescription)
        ? resolved.contentDescription
        : null;
  }

  // For images, let a vision model extract the meaning (transcribed text or a
  // description of the subject) so the capture is embedded and connected just
  // like a link's scraped article text. Failure degrades to the caption/reaction
  // fallback below.
  if (payload.kind === CaptureKind.IMAGE && payload.mediaUrl) {
    const image = await loadImageForVision(payload.mediaUrl);
    if (image) {
      const described = await describeImage(image);
      if (described) {
        contentTitle = described.title;
        contentDescription = described.description;
        contentBodyText = described.description;
        // Short gist for display — the description itself may be a verbatim
        // transcription, which we keep for grounding but never surface raw.
        captureSummary = described.summary;
      }
    }
  }

  let { tokens, combinedText } = sourceTokens({
    rawText: payload.text,
    caption: payload.caption,
    reaction: payload.reaction,
    userContext: payload.userContext,
    contentTitle,
    contentDescription,
    contentBodyText,
  });

  // "Thin" = we have essentially only a title (e.g. a YouTube video whose
  // transcript/description scrape failed). With no real content, the drafting
  // layer falls back to boilerplate that describes the app itself ("the memory
  // graph starts here…") instead of the capture — so we suppress that fallback
  // rather than emit a self-referential insight.
  const contentThin = !(
    contentDescription || contentBodyText || payload.text || payload.caption || payload.userContext
  );

  // How much actual substance grounds this capture — drives the anti-
  // confabulation directive in insight polishing. The user's own account and
  // notes count as grounding; the title alone does not.
  const contentGrounding = scoreContentConfidence({
    bodyText: [contentBodyText, payload.userContext, payload.text].filter(Boolean).join("\n"),
    description: contentDescription ?? payload.caption,
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

  // Embed the full semantic content (title + user account + excerpt + body +
  // user text) so the map and connections are driven by meaning, not keyword
  // overlap. The user's account leads so it dominates when the scrape is thin.
  const embeddingText = [contentTitle, payload.userContext, contentDescription, contentBodyText, payload.text, payload.caption, payload.reaction]
    .filter(Boolean)
    .join("\n\n");

  const [classified, insightStyle, embedding] = await Promise.all([
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
    embedText(embeddingText || combinedText),
  ]);

  const topicIdSet = new Set(classified.map((topic) => topic.topicId));
  const neighborInfo = await computeNeighbors({
    db,
    userId: payload.userId,
    itemTokens: tokens,
    itemTermVector: termVector,
    itemTopicIds: topicIdSet,
    itemPolarity,
    itemEmbedding: embedding,
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
    contentThin,
  });

  // Polish and recommendations are independent LLM calls (both need only the
  // classification + neighbors), so they run concurrently — serializing them
  // was ~2s of avoidable capture latency the user sits through.
  const [polishedDrafts, recommendations] = await Promise.all([
    polishInsights({
      style: insightStyle,
      itemTitle,
      contentText: combinedText,
      contentGrounding,
      userContext: payload.userContext,
      topicNames: classified.map((topic) => topic.name),
      neighborContext: neighborInfo.neighbors.map((n) => ({
        title: n.title,
        edgeType: n.edgeType,
      })),
      drafts,
    }),
    generateRecommendations({
      itemTitle,
      contentText: combinedText,
      topicNames: classified.map((t) => t.name),
      threadContext: threadContext ?? undefined,
      neighborTitles: neighborInfo.neighbors.slice(0, 3).map((n) => n.title),
    }),
  ]);

  const txResult = await prisma.$transaction(async (tx: DbClient) => {
    const created = await tx.capturedItem.create({
      data: {
        userId: payload.userId,
        kind: payload.kind,
        contentItemId,
        rawText: payload.text ?? null,
        caption: payload.caption ?? null,
        mediaUrl: payload.mediaUrl ?? null,
        reaction: payload.reaction ?? null,
        userContext: payload.userContext ?? null,
        // A short "what this is about" gist shown on the insight screen as the
        // AI summary — never the raw scraped body/transcript. keyIdea stays
        // unused; the reading surfaces show title, summary, reaction, insight.
        summary: captureSummary,
        keyIdea: null,
        terms: topTerms(termVector, 24),
        embedding: embedding ?? [],
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
  });

  return { ...txResult, threadContext, recommendations };
}

/**
 * Re-runs the cognition pipeline for an existing capture after the user
 * corrects the AI's understanding of the content (`userContext`). The user's
 * account is ground truth, so everything derived from the old text is rebuilt:
 * embedding, topics, connections, insights — and the persisted map position is
 * cleared so the semantic layout re-seats the node.
 */
export async function updateCaptureContext(args: {
  userId: string;
  capturedItemId: string;
  userContext: string;
  db?: RootDbClient;
}) {
  const db = args.db ?? prisma;
  const item = await db.capturedItem.findUnique({
    where: { id: args.capturedItemId },
    include: {
      contentItem: true,
      topics: { select: { topicId: true } },
    },
  });

  if (!item || item.userId !== args.userId) {
    throw new AppError("CAPTURE_NOT_FOUND", "Capture not found", 404);
  }

  const userContext = args.userContext.trim();
  const contentTitle = item.contentItem?.title ?? undefined;
  const contentDescription = item.contentItem?.description ?? undefined;
  const contentBodyText = item.contentItem?.bodyText ?? undefined;
  const rawText = item.rawText ?? undefined;
  const caption = item.caption ?? undefined;
  const reaction = item.reaction ?? undefined;

  const { tokens, combinedText } = sourceTokens({
    rawText,
    caption,
    reaction,
    userContext,
    contentTitle,
    contentDescription,
    contentBodyText,
  });

  if (tokens.length === 0) {
    throw new AppError("EMPTY_CAPTURE", "Capture is empty after parsing.", 422);
  }

  const termVector = termFrequency(tokens);
  const itemPolarity = polarity(tokens);
  const embeddingText = [contentTitle, userContext, contentDescription, contentBodyText, rawText, caption, reaction]
    .filter(Boolean)
    .join("\n\n");

  const contentGrounding = scoreContentConfidence({
    bodyText: [contentBodyText, userContext, rawText].filter(Boolean).join("\n"),
    description: contentDescription ?? caption,
  });

  const [classified, insightStyle, embedding] = await Promise.all([
    classifyTopics({
      db,
      userId: args.userId,
      tokens,
      title: contentTitle,
      description: contentDescription,
      combinedText,
    }),
    ensureUserPreference(db, args.userId),
    embedText(embeddingText || combinedText),
  ]);

  const topicIdSet = new Set(classified.map((topic) => topic.topicId));
  const neighborInfo = await computeNeighbors({
    db,
    userId: args.userId,
    itemTokens: tokens,
    itemTermVector: termVector,
    itemTopicIds: topicIdSet,
    itemPolarity,
    itemEmbedding: embedding,
    excludeCaptureId: item.id,
  });

  const topicMap = new Map<string, ClassifiedTopic>(
    classified.map((topic) => [topic.topicId, topic]),
  );
  const topicCounts = computeTopicCounts(neighborInfo.rawPriors, topicMap);
  const trajectory = computeTrajectory(neighborInfo.rawPriors, topicMap);
  const itemTitle = contentTitle ?? (rawText ?? caption ?? "Untitled capture").slice(0, 80);

  const drafts = draftInsights({
    style: insightStyle,
    itemTitle,
    topicNames: classified.map((topic) => topic.name),
    topNeighbors: neighborInfo.neighbors,
    topicCounts,
    shift: trajectory,
    isFirstCapture: false,
    contentThin: false,
  });

  const polishedDrafts = await polishInsights({
    style: insightStyle,
    itemTitle,
    contentText: combinedText,
    contentGrounding,
    userContext,
    topicNames: classified.map((topic) => topic.name),
    neighborContext: neighborInfo.neighbors.map((n) => ({
      title: n.title,
      edgeType: n.edgeType,
    })),
    drafts,
  });

  const oldTopicIds = new Set(item.topics.map((row) => row.topicId));
  const removedTopicIds = [...oldTopicIds].filter((id) => !topicIdSet.has(id));
  const addedTopicIds = [...topicIdSet].filter((id) => !oldTopicIds.has(id));

  await prisma.$transaction(async (tx: DbClient) => {
    await tx.capturedItem.update({
      where: { id: item.id },
      data: {
        userContext,
        terms: topTerms(termVector, 24),
        embedding: embedding ?? [],
        // Cleared so the semantic layout re-seats the node from the new embedding.
        mapX: null,
        mapY: null,
      },
    });

    await tx.capturedItemTopic.deleteMany({ where: { capturedItemId: item.id } });
    if (classified.length > 0) {
      await tx.capturedItemTopic.createMany({
        data: classified.map((topic) => ({
          capturedItemId: item.id,
          topicId: topic.topicId,
          weight: topic.score,
        })),
        skipDuplicates: true,
      });
    }

    if (removedTopicIds.length > 0) {
      await applyTopicWeights({ db: tx, userId: args.userId, topicIds: removedTopicIds, increment: -1 });
    }
    if (addedTopicIds.length > 0) {
      await applyTopicWeights({ db: tx, userId: args.userId, topicIds: addedTopicIds, increment: 1 });
    }

    // Edges in both directions were computed from the old understanding.
    await tx.memoryEdge.deleteMany({
      where: {
        userId: args.userId,
        OR: [{ fromItemId: item.id }, { toItemId: item.id }],
      },
    });
    if (neighborInfo.neighbors.length > 0) {
      await tx.memoryEdge.createMany({
        data: neighborInfo.neighbors.map((neighbor) => ({
          userId: args.userId,
          fromItemId: item.id,
          toItemId: neighbor.capturedItemId,
          type: neighbor.edgeType,
          weight: Number(neighbor.similarity.toFixed(4)),
        })),
        skipDuplicates: true,
      });
    }

    await tx.insight.deleteMany({ where: { capturedItemId: item.id } });
    for (const draft of polishedDrafts) {
      await tx.insight.create({
        data: {
          userId: args.userId,
          capturedItemId: item.id,
          type: draft.type,
          headline: draft.headline,
          body: draft.body,
          evidence: draft.evidence as Prisma.InputJsonValue,
          strength: draft.strength,
        },
      });
    }

    await incrementTasteProfileVersion(tx, args.userId);
  });

  return getCapture({ userId: args.userId, capturedItemId: item.id, db });
}

/**
 * Permanently deletes a capture: the row itself, and — via schema cascades —
 * every Insight, CapturedItemTopic, and MemoryEdge (both directions) that
 * references it. Nothing soft-deletes here; once this returns, the item
 * cannot be recovered and no longer participates in the memory graph, topic
 * counts, neighbor search, or taste profile.
 */
export async function deleteCapture(args: {
  userId: string;
  capturedItemId: string;
  db?: RootDbClient;
}): Promise<void> {
  const db = args.db ?? prisma;
  const item = await db.capturedItem.findUnique({
    where: { id: args.capturedItemId },
    select: { id: true, userId: true, topics: { select: { topicId: true } } },
  });

  if (!item || item.userId !== args.userId) {
    throw new AppError("CAPTURE_NOT_FOUND", "Capture not found", 404);
  }

  const topicIds = item.topics.map((t) => t.topicId);

  await prisma.$transaction(async (tx: DbClient) => {
    if (topicIds.length > 0) {
      // Undo this capture's contribution to the taste profile before the
      // CapturedItemTopic rows disappear with the cascade delete below.
      await applyTopicWeights({ db: tx, userId: args.userId, topicIds, increment: -1 });
    }

    // Cascades (schema onDelete: Cascade) remove Insight, CapturedItemTopic,
    // and MemoryEdge rows in both directions. CognitiveEvent/PositionChallenge
    // rows referencing it are historical logs and set their FK to null rather
    // than being deleted themselves.
    await tx.capturedItem.delete({ where: { id: item.id } });

    await incrementTasteProfileVersion(tx, args.userId);
  });
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
      edgesTo: {
        include: {
          fromItem: {
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

  // Edges are created from the newer capture to the older one, so a connection
  // shows up as `edgesFrom` on the newer node and `edgesTo` on the older node.
  // Merge both directions, dedup by neighbor id keeping the strongest edge.
  const relatedById = new Map<string, { item: CaptureWithRelations; edgeType: MemoryEdgeType; weight: number }>();
  for (const edge of item.edgesFrom) {
    const existing = relatedById.get(edge.toItemId);
    if (!existing || edge.weight > existing.weight) {
      relatedById.set(edge.toItemId, { item: edge.toItem, edgeType: edge.type, weight: edge.weight });
    }
  }
  for (const edge of item.edgesTo) {
    const existing = relatedById.get(edge.fromItemId);
    if (!existing || edge.weight > existing.weight) {
      relatedById.set(edge.fromItemId, { item: edge.fromItem, edgeType: edge.type, weight: edge.weight });
    }
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
    related: Array.from(relatedById.values())
      .sort((a, b) => b.weight - a.weight)
      .map((r) => ({
        ...serializeCapturedItem(r.item),
        edgeType: r.edgeType,
        edgeWeight: r.weight,
      })),
  };
}

export type CaptureListItem = CapturedItemSummary & {
  leadInsight: { id: string; type: string; headline: string } | null;
};

export function withLeadInsight(item: CaptureWithRelations & { insights: { id: string; type: string; headline: string }[] }): CaptureListItem {
  return {
    ...serializeCapturedItem(item),
    leadInsight: item.insights[0]
      ? { id: item.insights[0].id, type: item.insights[0].type, headline: item.insights[0].headline }
      : null,
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

  return items.map(withLeadInsight);
}
