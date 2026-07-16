import { CognitiveEventType, MemoryEdgeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import {
  isDegenerateLayout,
  isGroupIncoherentLayout,
  peripheralPoint,
  placeNewNode,
  semanticLayout,
  type LayoutPoint,
} from "@/server/cognition/layout";

const GRAPH_LIMIT_DEFAULT = 80;
const TRENDS_RECENT_DAYS = 7;
const TRENDS_PRIOR_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A topic needs this many recent captures before it can be called "rising". */
const MOMENTUM_MIN_RECENT = 2;

export type TopicMomentum = {
  topicId: string;
  name: string;
  recent: number;
  prior: number;
  lift: number;
  lastCapturedAt: Date;
};

type MomentumItem = {
  capturedAt: Date;
  topics: { topicId: string; name: string }[];
};

/**
 * Rank topics by how much faster they're being captured *now* than they used to
 * be — a per-day rate comparison, not a raw count difference.
 *
 * Raw `recent - prior` is not a momentum signal: the two windows are different
 * lengths (7 days vs 23), so the counts aren't comparable, and the topic with
 * the most captures overall tends to win regardless of whether it's actually
 * accelerating. Comparing rates puts a small topic that just woke up ahead of a
 * large one ticking along at its usual pace, which is what "rising" means.
 *
 * `MOMENTUM_MIN_RECENT` keeps a single stray capture in a brand-new topic from
 * taking the crown; the smoothing term keeps a topic with no history from
 * dividing by zero.
 */
export function rankTopicMomentum(
  items: MomentumItem[],
  opts: { recentDays: number; priorDays: number; now?: number },
): TopicMomentum[] {
  const now = opts.now ?? Date.now();
  const priorWindowDays = Math.max(1, opts.priorDays - opts.recentDays);
  const recentCutoff = now - opts.recentDays * DAY_MS;
  const priorCutoff = now - opts.priorDays * DAY_MS;
  // One capture spread across the whole prior window — the rate at which a
  // topic is indistinguishable from noise. Both sides get it, so a topic with
  // no history gets a large but finite lift instead of Infinity.
  const smoothing = 1 / opts.priorDays;

  const byTopic = new Map<string, { topicId: string; name: string; recent: number; prior: number; lastCapturedAt: Date }>();

  for (const item of items) {
    const ts = item.capturedAt.getTime();
    if (ts < priorCutoff) continue;
    const isRecent = ts >= recentCutoff;

    for (const topic of item.topics) {
      const entry = byTopic.get(topic.topicId) ?? {
        topicId: topic.topicId,
        name: topic.name,
        recent: 0,
        prior: 0,
        lastCapturedAt: item.capturedAt,
      };

      if (isRecent) entry.recent += 1;
      else entry.prior += 1;
      if (item.capturedAt > entry.lastCapturedAt) entry.lastCapturedAt = item.capturedAt;

      byTopic.set(topic.topicId, entry);
    }
  }

  return [...byTopic.values()]
    .filter((entry) => entry.recent >= MOMENTUM_MIN_RECENT)
    .map((entry) => {
      const recentRate = entry.recent / opts.recentDays;
      const priorRate = entry.prior / priorWindowDays;
      return { ...entry, lift: (recentRate + smoothing) / (priorRate + smoothing) };
    })
    // Ties break toward whichever topic was touched most recently — never
    // toward the biggest, which is the bias this whole function exists to undo.
    .sort((a, b) => b.lift - a.lift || b.lastCapturedAt.getTime() - a.lastCapturedAt.getTime());
}

/** The single topic to call "rising", or null when nothing is accelerating. */
export function pickRisingTopic(
  items: MomentumItem[],
  opts: { recentDays: number; priorDays: number; now?: number },
): { topicId: string; name: string } | null {
  const top = rankTopicMomentum(items, opts)[0];
  if (!top || top.lift <= 1) return null;
  return { topicId: top.topicId, name: top.name };
}

type GraphNode = {
  id: string;
  label: string;
  kind: string;
  topics: { topicId: string; name: string; kind: "general" | "specific" }[];
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
  /**
   * 'domain' when this topic is the coarse classification anchor (highest
   * weight) for most of its members — the label to show zoomed out. 'topic'
   * for the more specific labels that take over as the user zooms in.
   */
  kind: "domain" | "topic";
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
  mapX?: number | null;
  mapY?: number | null;
  /** Topic rows, highest weight first (as fetched by getMemoryGraph) — used to
   * derive the node's primary general field for the layout's domain prior. */
  topics?: { topic: { name: string } }[];
};

/** The node's coarse classification: its first canonical general topic. The
 * neutral "general" bucket is not in GENERAL_TOPICS, so unclassifiable nodes
 * yield null and are laid out from embeddings alone. */
function primaryGeneralOf(item: Positionable): string | null {
  for (const row of item.topics ?? []) {
    if (isGeneralTopic(row.topic.name)) return row.topic.name.toLowerCase();
  }
  return null;
}

/**
 * Resolves stable semantic coordinates for the visible captures.
 *
 * Coordinates are PERSISTED (`mapX`/`mapY`) so a plain refetch never reshuffles
 * the map. When new captures arrive, the WHOLE embeddable set is re-laid-out
 * with SMACOF, warm-started from the persisted coordinates: existing nodes only
 * drift as far as the embedding distances require, new nodes are seeded next to
 * their most similar anchors, and the global geometry stays faithful in 2D.
 * (Greedily freezing anchors and fitting one node at a time — the previous
 * approach — degenerates to a line: a new point placed by gradient descent
 * against collinear anchors can never leave that line, and early placement
 * mistakes were permanent.)
 *
 * A persisted layout that is itself degenerate (nearly collinear/coincident,
 * i.e. produced by the old greedy path) also triggers the re-layout, so
 * existing maps heal on the next fetch.
 */
async function resolveSemanticCoords(
  db: DbClient,
  captures: Positionable[],
): Promise<Record<string, { x: number; y: number }>> {
  const coords: Record<string, { x: number; y: number }> = {};
  // Oldest first, so earlier captures anchor the placement of later ones.
  const ordered = [...captures].reverse();

  // Fast path — embeddings are ~12KB per node, so they are NOT part of the
  // graph query. When every node already has healthy persisted coordinates
  // (the steady state: plain refetches, tab focus), skip the fetch entirely.
  const allPositioned = ordered.filter((it) => it.mapX != null && it.mapY != null);
  const anyUnpositioned = allPositioned.length < ordered.length;
  const positionedPoints = allPositioned.map((it) => ({
    x: it.mapX!,
    y: it.mapY!,
    group: primaryGeneralOf(it),
  }));
  const maybeDegenerate = isDegenerateLayout(positionedPoints);
  // A layout that strongly contradicts the nodes' general fields (a science
  // capture parked inside the psychology cluster — the pre-domain-prior
  // failure shape) heals with one group-aware re-layout.
  const groupIncoherent = isGroupIncoherentLayout(positionedPoints);
  if (groupIncoherent) console.log("[layout] group-coherence heal triggered");
  if (!anyUnpositioned && !maybeDegenerate && !groupIncoherent) {
    for (const it of allPositioned) coords[it.id] = { x: it.mapX!, y: it.mapY! };
    return coords;
  }

  const embeddingRows = await db.capturedItem.findMany({
    where: { id: { in: ordered.map((it) => it.id) } },
    select: { id: true, embedding: true },
  });
  const embeddingById = new Map(embeddingRows.map((r) => [r.id, r.embedding]));
  const withEmbedding = ordered.map((it) => ({
    ...it,
    embedding: embeddingById.get(it.id) ?? [],
  }));

  const embeddable = withEmbedding.filter((it) => it.embedding.length > 0);
  const nonEmbeddable = withEmbedding.filter((it) => it.embedding.length === 0);

  const toPersist: { id: string; x: number; y: number }[] = [];

  // Un-embeddable items live on a deterministic peripheral ring, untouched by
  // the semantic relaxation.
  for (const it of nonEmbeddable) {
    if (it.mapX != null && it.mapY != null) {
      coords[it.id] = { x: it.mapX, y: it.mapY };
    } else {
      const p = peripheralPoint(it.id);
      coords[it.id] = p;
      toPersist.push({ id: it.id, x: p.x, y: p.y });
    }
  }

  const positioned = embeddable.filter((it) => it.mapX != null && it.mapY != null);
  const unpositioned = embeddable.filter((it) => it.mapX == null || it.mapY == null);

  const needsLayout =
    unpositioned.length > 0 ||
    groupIncoherent ||
    isDegenerateLayout(positioned.map((it) => ({ x: it.mapX!, y: it.mapY! })));

  if (!needsLayout) {
    for (const it of positioned) coords[it.id] = { x: it.mapX!, y: it.mapY! };
  } else if (embeddable.length > 0) {
    // Warm-start: positioned nodes at their persisted spots; new nodes seeded
    // near their most similar anchors so they converge into the right region.
    const init: Record<string, LayoutPoint> = {};
    const anchors: { x: number; y: number; embedding?: number[] | null }[] = [];
    for (const it of positioned) {
      init[it.id] = { x: it.mapX!, y: it.mapY! };
      anchors.push({ x: it.mapX!, y: it.mapY!, embedding: it.embedding ?? null });
    }
    for (const it of unpositioned) {
      const seed = anchors.length > 0 ? placeNewNode(it.embedding ?? null, anchors) : null;
      if (seed) {
        init[it.id] = seed;
        anchors.push({ x: seed.x, y: seed.y, embedding: it.embedding ?? null });
      }
    }

    const layout = semanticLayout(
      embeddable.map((it) => ({
        id: it.id,
        embedding: it.embedding ?? null,
        group: primaryGeneralOf(it),
      })),
      { init },
    );

    for (const it of embeddable) {
      const p = layout[it.id] ?? peripheralPoint(it.id);
      coords[it.id] = p;
      if (p.x !== it.mapX || p.y !== it.mapY) {
        toPersist.push({ id: it.id, x: p.x, y: p.y });
      }
    }
  }

  if (toPersist.length === 0) return coords;

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
  /** When set, the graph is that topic's complete sub-map (up to the limit). */
  topicId?: string;
  db?: DbClient;
}): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
  positions: { topicId: string; statement: string; status: 'ACTIVE' | 'REVISED' | 'ABANDONED' }[];
  /** Captures matching the filter BEFORE the limit — lets the client say "showing N of M". */
  totalCount: number;
}> {
  const db = args.db ?? prisma;
  const limit = Math.min(Math.max(args.limit ?? GRAPH_LIMIT_DEFAULT, 10), 200);

  const where = {
    userId: args.userId,
    ...(args.topicId ? { topics: { some: { topicId: args.topicId } } } : {}),
  };

  // Narrow select: embeddings (~12KB/node) are deliberately excluded — the
  // layout resolver fetches them lazily, only when a re-layout is needed.
  const captures = await db.capturedItem.findMany({
    where,
    orderBy: { capturedAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      rawText: true,
      caption: true,
      reaction: true,
      keyIdea: true,
      capturedAt: true,
      mapX: true,
      mapY: true,
      contentItem: { select: { title: true } },
      // Highest-weight topic first: the coarse domain (score 1.0) leads, so the
      // semantic layout anchors each node to its broad field deterministically.
      topics: { include: { topic: true }, orderBy: { weight: "desc" } },
    },
  });

  const [coords, totalCount] = await Promise.all([
    resolveSemanticCoords(db, captures),
    // Cheap fast path: an un-truncated page IS the full count.
    captures.length < limit
      ? Promise.resolve(captures.length)
      : db.capturedItem.count({ where }),
  ]);

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
      kind: isGeneralTopic(row.topic.name) ? "general" as const : "specific" as const,
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
  // A cluster is a 'domain' (coarse label shown zoomed out) iff its topic is one
  // of the canonical general fields; specific topics are 'topic' labels that
  // take over on zoom-in. Derived from the topic name, so it's deterministic.
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
          kind: topic.kind === "general" ? "domain" : "topic",
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
    totalCount,
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

  // Which topic is actually accelerating. `shifts` is ranked by raw count delta,
  // which is dominated by whichever topic is already the largest — so it can't
  // answer this. See rankTopicMomentum.
  const rising = pickRisingTopic(
    captures.map((item) => ({
      capturedAt: item.capturedAt,
      topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),
    })),
    { recentDays, priorDays, now },
  );

  return {
    window: windowKey,
    captureCount: captures.length,
    sparkline: sparkBuckets.map(({ day, count }) => ({ day, count })),
    themes: themes.slice(0, 10),
    shifts,
    recurring,
    rising,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
    })),
  };
}
