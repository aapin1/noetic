import { MemoryEdgeType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import {
  generateContradictionTension,
  generateThreadSynthesis,
  generateConvergenceSignal,
  generateTopicTension,
} from "@/server/cognition/llm";

// Thresholds are deliberately low so insights start surfacing within the
// first handful of captures and keep refreshing as new ones land. Mind is a
// living picture of how you're thinking, not a report that only appears once
// you've amassed a large archive.
const DORMANT_ACTIVE_MIN = 2;
const DORMANT_SILENT_DAYS = 14;
const DORMANT_LIMIT = 4;
const CONVERGENCE_SOURCE_MIN = 2;
const CONVERGENCE_LIMIT = 3;
const CAPTURE_SCAN_LIMIT = 200;
const CONTRADICTION_EDGE_LIMIT = 5;
const CONTRADICTION_CARD_LIMIT = 6;
// Topics with at least this many captures are scanned by the LLM for internal
// tension (friction / ambivalence / competing intuitions), not just the hard
// polarity-based CONTRADICTS edges.
const TOPIC_TENSION_MIN = 3;
const TOPIC_TENSION_SCAN = 4;
const THREAD_SYNTHESIS_THRESHOLD = 3;
const THREAD_SYNTHESIS_LIMIT = 4;
const THREAD_ITEM_IDS_LIMIT = 12;

export type LoadedCapture = {
  id: string;
  label: string;
  rawText: string | null;
  /** Best available account of the capture's substance for LLM grounding:
   * user's own text, else their context note, else the AI summary/excerpt.
   * Link captures have rawText = null, so without this they were title-only. */
  gist: string;
  keyIdea: string | null;
  capturedAt: Date;
  sourceName: string | null;
  topics: { topicId: string; name: string }[];
};

export type TopicGroup = {
  topicId: string;
  topicName: string;
  captures: LoadedCapture[];
};

export type ContradictionCard = {
  itemAId: string;
  itemBId: string;
  labelA: string;
  labelB: string;
  previewA: string;
  previewB: string;
  tension: string;
};

export type ThreadSynthesis = {
  topicId: string;
  topicName: string;
  captureCount: number;
  position: string;
  openQuestion: string;
  /** Capture ids feeding this thread — used to deep-link into companion/Atlas. */
  itemIds: string[];
};

export type ConvergenceSignal = {
  topicId: string;
  topicName: string;
  captureCount: number;
  sourceCount: number;
  signal: string;
};

export type DormantThread = {
  topicId: string;
  topicName: string;
  captureCount: number;
  lastCapturedAt: string;
  daysSilent: number;
};

export type PersonalIntelligenceData = {
  contradictionCards: ContradictionCard[];
  threadSyntheses: ThreadSynthesis[];
  convergenceSignals: ConvergenceSignal[];
  dormantThreads: DormantThread[];
};

export function groupCapturesByTopic(captures: LoadedCapture[], minCount: number): TopicGroup[] {
  const map = new Map<string, TopicGroup>();
  for (const capture of captures) {
    for (const topic of capture.topics) {
      const existing = map.get(topic.topicId);
      if (existing) {
        existing.captures.push(capture);
      } else {
        map.set(topic.topicId, {
          topicId: topic.topicId,
          topicName: topic.name,
          captures: [capture],
        });
      }
    }
  }
  return Array.from(map.values())
    .filter((g) => g.captures.length >= minCount)
    .sort((a, b) => b.captures.length - a.captures.length);
}

export function findDormantThreads(topicGroups: TopicGroup[], now: Date): DormantThread[] {
  const dormantCutoff = new Date(now.getTime() - DORMANT_SILENT_DAYS * 24 * 60 * 60 * 1000);
  const result: DormantThread[] = [];

  for (const group of topicGroups) {
    if (group.captures.length < DORMANT_ACTIVE_MIN) continue;
    const sorted = [...group.captures].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
    const last = sorted[0];
    if (last.capturedAt < dormantCutoff) {
      result.push({
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        lastCapturedAt: last.capturedAt.toISOString(),
        daysSilent: Math.floor((now.getTime() - last.capturedAt.getTime()) / (24 * 60 * 60 * 1000)),
      });
    }
  }

  return result.sort((a, b) => b.captureCount - a.captureCount).slice(0, DORMANT_LIMIT);
}

export function findConvergenceCandidates(topicGroups: TopicGroup[]): TopicGroup[] {
  return topicGroups.filter((group) => {
    const sources = new Set(group.captures.map((c) => c.sourceName ?? "__unknown__"));
    return sources.size >= CONVERGENCE_SOURCE_MIN;
  });
}

export async function getPersonalIntelligence(args: {
  userId: string;
  db?: DbClient;
}): Promise<PersonalIntelligenceData> {
  const db = args.db ?? prisma;

  // The LLM-derived sections only change when the memory graph does, so they
  // are cached against tasteProfileVersion (bumped on every capture add/edit/
  // delete). Dormant threads depend on the passage of time, not the graph, so
  // they are recomputed from the DB on every request — no LLM involved.
  const [user, cached, rawCaptures] = await Promise.all([
    db.user.findUnique({
      where: { id: args.userId },
      select: { tasteProfileVersion: true },
    }),
    db.intelligenceCache.findUnique({ where: { userId: args.userId } }),
    db.capturedItem.findMany({
      where: { userId: args.userId },
      orderBy: { capturedAt: "desc" },
      take: CAPTURE_SCAN_LIMIT,
      include: {
        contentItem: { include: { source: true } },
        topics: { include: { topic: true } },
      },
    }),
  ]);

  const captures: LoadedCapture[] = rawCaptures.map((item) => ({
    id: item.id,
    label: item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture",
    rawText: item.rawText,
    gist: [item.rawText, item.userContext, item.summary, item.contentItem?.description]
      .find((part) => part && part.trim().length > 0) ?? "",
    keyIdea: item.keyIdea,
    capturedAt: item.capturedAt,
    sourceName: item.contentItem?.source?.name ?? item.contentItem?.siteName ?? null,
    topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),
  }));

  const allGroups = groupCapturesByTopic(captures, 2);
  const threadCandidates = allGroups.filter((g) => g.captures.length >= THREAD_SYNTHESIS_THRESHOLD);

  const now = new Date();
  const dormantThreads = findDormantThreads(allGroups, now);

  if (user && cached && cached.version === user.tasteProfileVersion) {
    const payload = cached.payload as unknown as PersonalIntelligenceData;
    if (payload && Array.isArray(payload.contradictionCards)) {
      return { ...payload, dormantThreads };
    }
  }

  const contradictEdges = await db.memoryEdge.findMany({
    where: { userId: args.userId, type: MemoryEdgeType.CONTRADICTS },
    orderBy: { createdAt: "desc" },
    take: CONTRADICTION_EDGE_LIMIT,
    include: {
      fromItem: { include: { contentItem: true } },
      toItem: { include: { contentItem: true } },
    },
  });

  const convergenceCandidates = findConvergenceCandidates(allGroups).slice(0, CONVERGENCE_LIMIT);

  // Pairs already captured as hard CONTRADICTS edges — so the softer LLM
  // tension scan doesn't surface the same pair twice.
  const edgePairKeys = new Set(
    contradictEdges.flatMap((e) => [
      `${e.fromItemId}:${e.toItemId}`,
      `${e.toItemId}:${e.fromItemId}`,
    ]),
  );
  const tensionGroups = allGroups
    .filter((g) => g.captures.length >= TOPIC_TENSION_MIN)
    .slice(0, TOPIC_TENSION_SCAN);

  function edgeItemLabel(item: { rawText: string | null; contentItem: { title: string } | null }): string {
    return item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture";
  }

  function edgeItemText(item: {
    rawText: string | null;
    userContext: string | null;
    summary: string | null;
    keyIdea: string | null;
    contentItem: { description: string | null } | null;
  }): string {
    return [item.rawText, item.userContext, item.summary, item.contentItem?.description, item.keyIdea]
      .find((part) => part && part.trim().length > 0) ?? "";
  }

  const [cardTensions, syntheses, convergenceTexts, topicTensions] = await Promise.all([
    Promise.all(
      contradictEdges.map((edge) =>
        generateContradictionTension({
          labelA: edgeItemLabel(edge.fromItem),
          textA: edgeItemText(edge.fromItem),
          labelB: edgeItemLabel(edge.toItem),
          textB: edgeItemText(edge.toItem),
        }),
      ),
    ),
    Promise.all(
      threadCandidates.slice(0, THREAD_SYNTHESIS_LIMIT).map((group) =>
        generateThreadSynthesis({
          topicName: group.topicName,
          captures: group.captures.slice(0, 10).map((c) => ({
            label: c.label,
            keyIdea: c.keyIdea,
            text: c.gist,
          })),
        }),
      ),
    ),
    Promise.all(
      convergenceCandidates.map((group) =>
        generateConvergenceSignal({
          topicName: group.topicName,
          captures: group.captures.slice(0, 8).map((c) => ({
            label: c.label,
            source: c.sourceName,
            keyIdea: c.keyIdea,
          })),
        }),
      ),
    ),
    Promise.all(
      tensionGroups.map((group) =>
        generateTopicTension({
          topicName: group.topicName,
          captures: group.captures.slice(0, 8).map((c) => ({
            label: c.label,
            keyIdea: c.keyIdea,
            text: c.gist,
          })),
        }),
      ),
    ),
  ]);

  const edgeCards: ContradictionCard[] = contradictEdges
    .map((edge, i) => {
      const tension = cardTensions[i];
      if (!tension) return null;
      return {
        itemAId: edge.fromItemId,
        itemBId: edge.toItemId,
        labelA: edgeItemLabel(edge.fromItem),
        labelB: edgeItemLabel(edge.toItem),
        previewA: edgeItemText(edge.fromItem).slice(0, 200),
        previewB: edgeItemText(edge.toItem).slice(0, 200),
        tension,
      };
    })
    .filter((c): c is ContradictionCard => c !== null);

  const tensionCards: ContradictionCard[] = tensionGroups
    .map((group, i) => {
      const result = topicTensions[i];
      if (!result) return null;
      const a = group.captures[result.aIndex];
      const b = group.captures[result.bIndex];
      if (!a || !b || a.id === b.id) return null;
      if (edgePairKeys.has(`${a.id}:${b.id}`)) return null;
      return {
        itemAId: a.id,
        itemBId: b.id,
        labelA: a.label,
        labelB: b.label,
        previewA: a.gist.slice(0, 200),
        previewB: b.gist.slice(0, 200),
        tension: result.tension,
      };
    })
    .filter((c): c is ContradictionCard => c !== null);

  // Hard edges first, then softer topic tensions; dedupe by unordered pair.
  const seenPairs = new Set<string>();
  const contradictionCards: ContradictionCard[] = [];
  for (const card of [...edgeCards, ...tensionCards]) {
    const key = [card.itemAId, card.itemBId].sort().join(":");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    contradictionCards.push(card);
    if (contradictionCards.length >= CONTRADICTION_CARD_LIMIT) break;
  }

  const threadSyntheses: ThreadSynthesis[] = threadCandidates
    .slice(0, THREAD_SYNTHESIS_LIMIT)
    .map((group, i) => {
      const synthesis = syntheses[i];
      if (!synthesis) return null;
      return {
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        position: synthesis.position,
        openQuestion: synthesis.openQuestion,
        itemIds: group.captures.slice(0, THREAD_ITEM_IDS_LIMIT).map((c) => c.id),
      };
    })
    .filter((s): s is ThreadSynthesis => s !== null);

  const convergenceSignals: ConvergenceSignal[] = convergenceCandidates
    .map((group, i) => {
      const signal = convergenceTexts[i];
      if (!signal) return null;
      return {
        topicId: group.topicId,
        topicName: group.topicName,
        captureCount: group.captures.length,
        sourceCount: new Set(group.captures.map((c) => c.sourceName ?? "__unknown__")).size,
        signal,
      };
    })
    .filter((s): s is ConvergenceSignal => s !== null);

  const result: PersonalIntelligenceData = {
    contradictionCards,
    threadSyntheses,
    convergenceSignals,
    dormantThreads,
  };

  if (user) {
    // Best-effort: a failed cache write must never fail the request.
    try {
      await db.intelligenceCache.upsert({
        where: { userId: args.userId },
        update: {
          version: user.tasteProfileVersion,
          payload: result as unknown as Prisma.InputJsonValue,
        },
        create: {
          userId: args.userId,
          version: user.tasteProfileVersion,
          payload: result as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // ignore
    }
  }

  return result;
}
