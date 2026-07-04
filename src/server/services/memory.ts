import { CognitiveEventType, MemoryEdgeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { peripheralPoint, placeNewNode, semanticLayout } from "@/server/cognition/layout";

const GRAPH_LIMIT_DEFAULT = 80;
const TRENDS_RECENT_DAYS = 7;
const TRENDS_PRIOR_DAYS = 30;

type GraphNode = {
  id: string;
  label: string;
  kind: string;
  topics: { topicId: string; name: string }[];
  capturedAt: Date;
  reaction: string | null;
  keyIdea: string | null;
  /** Deterministic semantic-map coordinates, normalized to [0,1]. */
  x: number;
  y: number;
};

type GraphEdge = {
  fromItemId: string;
  toItemId: string;
  type: MemoryEdgeType;
  weight: number;
};

type GraphCluster = {
  topicId: string;
  name: string;
  count: number;
  itemIds: string[];
};

function nodeLabel(input: {
  contentTitle?: string | null;
  rawText?: string | null;
  caption?: string | null;
  kind: string;
}): string {
  if (input.contentTitle) {
    return input.contentTitle;
  }

  const text = (input.rawText ?? input.caption ?? "").trim();

  if (text.length === 0) {
    return input.kind === "IMAGE" ? "Image" : "Untitled";
  }

  return text.length > 64 ? `${text.slice(0, 61).trimEnd()}…` : text;
}

type Positionable = {
  id: string;
  embedding?: number[] | null;
  mapX?: number | null;
  mapY?: number | null;
};

/**
 * Resolves stable semantic coordinates for the visible captures.
 *
 * Coordinates are PERSISTED (`mapX`/`mapY`): once a node is placed it keeps its
 * spot, so the map never reshuffles on refetch or when a new capture is added —
 * only the new node gets fitted into the existing frame (next to what it's
 * semantically near). Already-positioned nodes are the fixed anchors; newly
 * captured nodes are placed against them and their coordinates are written back.
 * On a cold start (nothing positioned yet) it bootstraps the whole set once.
 */
async function resolveSemanticCoords(
  db: DbClient,
  captures: Positionable[],
): Promise<Record<string, { x: number; y: number }>> {
  const coords: Record<string, { x: number; y: number }> = {};
  // Oldest first, so earlier captures anchor the placement of later ones.
  const ordered = [...captures].reverse();

  const anchors: { x: number; y: number; embedding?: number[] | null }[] = [];
  const unpositioned: Positionable[] = [];

  for (const item of ordered) {
    if (item.mapX != null && item.mapY != null) {
      coords[item.id] = { x: item.mapX, y: item.mapY };
      anchors.push({ x: item.mapX, y: item.mapY, embedding: item.embedding ?? null });
    } else {
      unpositioned.push(item);
    }
  }

  if (unpositioned.length === 0) return coords;

  const toPersist: { id: string; x: number; y: number }[] = [];

  // Cold start: no positioned anchors yet — lay out the embeddable ones together.
  if (anchors.length === 0) {
    const boot = semanticLayout(
      unpositioned.map((it) => ({ id: it.id, embedding: it.embedding ?? null })),
    );
    for (const it of unpositioned) {
      const p = boot[it.id] ?? peripheralPoint(it.id);
      coords[it.id] = p;
      toPersist.push({ id: it.id, x: p.x, y: p.y });
      anchors.push({ x: p.x, y: p.y, embedding: it.embedding ?? null });
    }
  } else {
    for (const it of unpositioned) {
      const p = placeNewNode(it.embedding ?? null, anchors) ?? peripheralPoint(it.id);
      coords[it.id] = p;
      toPersist.push({ id: it.id, x: p.x, y: p.y });
      anchors.push({ x: p.x, y: p.y, embedding: it.embedding ?? null });
    }
  }

  // Materialize the freshly computed coordinates (idempotent; best-effort).
  try {
    await Promise.all(
      toPersist.map((p) =>
        db.capturedItem.update({ where: { id: p.id }, data: { mapX: p.x, mapY: p.y } }),
      ),
    );
  } catch {
    // Non-fatal: the map still renders with the computed coords this request.
  }

  return coords;
}

export async function getMemoryGraph(args: {
  userId: string;
  limit?: number;
  db?: DbClient;
}): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  positions: { topicId: string; statement: string; status: 'ACTIVE' | 'REVISED' | 'ABANDONED' }[];
}> {
  const db = args.db ?? prisma;
  const limit = Math.min(Math.max(args.limit ?? GRAPH_LIMIT_DEFAULT, 10), 200);

  const captures = await db.capturedItem.findMany({
    where: { userId: args.userId },
    orderBy: { capturedAt: "desc" },
    take: limit,
    include: {
      contentItem: { select: { title: true } },
      // Highest-weight topic first: the coarse domain (score 1.0) leads, so the
      // semantic layout anchors each node to its broad field deterministically.
      topics: { include: { topic: true }, orderBy: { weight: "desc" } },
    },
  });

  const coords = await resolveSemanticCoords(db, captures);

  const nodes: GraphNode[] = captures.map((item) => ({
    id: item.id,
    label: nodeLabel({
      contentTitle: item.contentItem?.title,
      rawText: item.rawText,
      caption: item.caption,
      kind: item.kind,
    }),
    kind: item.kind,
    topics: item.topics.map((row) => ({
      topicId: row.topicId,
      name: row.topic.name,
    })),
    capturedAt: item.capturedAt,
    reaction: item.reaction,
    keyIdea: item.keyIdea,
    x: coords[item.id]?.x ?? 0.5,
    y: coords[item.id]?.y ?? 0.5,
  }));

  const ids = new Set(nodes.map((node) => node.id));

  const edges = ids.size === 0
    ? []
    : await db.memoryEdge.findMany({
      where: {
        userId: args.userId,
        fromItemId: { in: Array.from(ids) },
        toItemId: { in: Array.from(ids) },
      },
    });

  const clusterMap = new Map<string, GraphCluster>();

  for (const node of nodes) {
    for (const topic of node.topics) {
      const existing = clusterMap.get(topic.topicId);

      if (existing) {
        existing.count += 1;
        existing.itemIds.push(node.id);
      } else {
        clusterMap.set(topic.topicId, {
          topicId: topic.topicId,
          name: topic.name,
          count: 1,
          itemIds: [node.id],
        });
      }
    }
  }

  const positions = await db.userPosition.findMany({
    where: { userId: args.userId, status: { not: "ABANDONED" } },
    select: { topicId: true, statement: true, status: true },
  });

  return {
    nodes,
    edges: edges.map((edge) => ({
      fromItemId: edge.fromItemId,
      toItemId: edge.toItemId,
      type: edge.type,
      weight: edge.weight,
    })),
    clusters: Array.from(clusterMap.values()).sort((a, b) => b.count - a.count),
    positions,
  };
}

export type TrendsWindow = "week" | "month";

export async function getMemoryTrends(args: {
  userId: string;
  window?: TrendsWindow;
  db?: DbClient;
}) {
  const db = args.db ?? prisma;
  const windowKey = args.window ?? "week";
  const recentDays = windowKey === "week" ? TRENDS_RECENT_DAYS : TRENDS_PRIOR_DAYS;
  const priorDays = windowKey === "week" ? TRENDS_PRIOR_DAYS : TRENDS_PRIOR_DAYS * 3;
  const now = Date.now();
  const recentCutoff = new Date(now - recentDays * 24 * 60 * 60 * 1000);
  const priorCutoff = new Date(now - priorDays * 24 * 60 * 60 * 1000);

  const [captures, events] = await Promise.all([
    db.capturedItem.findMany({
      where: {
        userId: args.userId,
        capturedAt: { gte: priorCutoff },
      },
      orderBy: { capturedAt: "asc" },
      include: {
        topics: { include: { topic: true } },
      },
    }),
    db.cognitiveEvent.findMany({
      where: {
        userId: args.userId,
        occurredAt: { gte: priorCutoff },
        type: { in: [CognitiveEventType.TOPIC_SHIFT, CognitiveEventType.CONTRADICTION_DETECTED] },
      },
      orderBy: { occurredAt: "desc" },
      take: 25,
    }),
  ]);

  const topicCounts = new Map<string, { topicId: string; name: string; recent: number; prior: number }>();

  for (const item of captures) {
    const inRecent = item.capturedAt >= recentCutoff;

    for (const row of item.topics) {
      const entry = topicCounts.get(row.topicId) ?? {
        topicId: row.topicId,
        name: row.topic.name,
        recent: 0,
        prior: 0,
      };

      if (inRecent) {
        entry.recent += 1;
      } else {
        entry.prior += 1;
      }

      topicCounts.set(row.topicId, entry);
    }
  }

  const themes = Array.from(topicCounts.values())
    .map((entry) => ({
      ...entry,
      delta: entry.recent - entry.prior,
      total: entry.recent + entry.prior,
    }))
    .sort((a, b) => b.total - a.total);

  const shifts = themes
    .filter((entry) => entry.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  const recurring = themes.filter((entry) => entry.total >= 3).slice(0, 5);

  const sparkBuckets = Array.from({ length: recentDays }, (_, index) => {
    const start = new Date(now - (recentDays - index) * 24 * 60 * 60 * 1000);
    const end = new Date(now - (recentDays - index - 1) * 24 * 60 * 60 * 1000);
    return {
      day: start.toISOString().slice(0, 10),
      start,
      end,
      count: 0,
    };
  });

  for (const item of captures) {
    if (item.capturedAt < recentCutoff) {
      continue;
    }

    const ts = item.capturedAt.getTime();
    const bucket = sparkBuckets.find((b) => ts >= b.start.getTime() && ts < b.end.getTime());

    if (bucket) {
      bucket.count += 1;
    }
  }

  return {
    window: windowKey,
    captureCount: captures.length,
    sparkline: sparkBuckets.map(({ day, count }) => ({ day, count })),
    themes: themes.slice(0, 10),
    shifts,
    recurring,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
    })),
  };
}
