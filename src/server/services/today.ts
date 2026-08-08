import { MemoryEdgeType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import {
  captureSummarySelect,
  serializeCapturedItem,
  type CapturedItemSummary,
} from "@/server/services/cognition";
import { localDayIndex } from "@/server/services/streak";

/**
 * The /today ritual's read: one resurfaced capture with a rule-based "why
 * now", plus its strongest existing connection edge. Entirely structural — no
 * LLM calls, no notification writes. This is deliberately NOT
 * selectResurfaceCandidate: that selector is notification-shaped (it consumes
 * keys and stands down for 20h after any push), while /today must answer
 * every open, the same way all day, without spending anything.
 */

const DAY_MS = 86_400_000;
/** Below this there is no past to hand back — the screen shows a quiet empty state. */
const MIN_CORPUS = 5;
/** A capture younger than this is memory, not history. */
const MIN_AGE_DAYS = 7;
const CAPTURE_SCAN_LIMIT = 200;
const ANNIVERSARIES = [30, 60, 90];
const ANNIVERSARY_TOLERANCE_DAYS = 2;
/** Same floor the insight screen's "connected memory" list uses. */
const EDGE_MIN_WEIGHT = 0.45;
/**
 * A CONTRADICTS edge strong enough to take over the ritual. Edge weight is the
 * pair's cosine similarity, and classifyEdgeSemantic only calls contradiction
 * inside 0.40–0.62 — so 0.5 is the upper half of the band: clearly related
 * content, genuinely diverging stance.
 */
const COLLISION_MIN_WEIGHT = 0.5;
/** How long a strong contradiction holds the surface before the ritual resumes.
 * The takeover has no dismissal state of its own, so freshness is the bound. */
const COLLISION_FRESH_DAYS = 3;

export type TodayConnection = {
  itemId: string;
  title: string;
  type: string;
  weight: number;
};

/** An unacknowledged challenge to a staked position — the surface's lead when
 * present, because it is the one thing here that demands an answer. */
export type TodayChallenge = {
  challengeId: string;
  topicId: string;
  topicName: string;
  statement: string;
  tension: string;
  capture: { id: string; title: string } | null;
};

/** A fresh, strong CONTRADICTS pair — two things you saved that disagree. */
export type TodayCollision = {
  itemA: { id: string; title: string };
  itemB: { id: string; title: string };
};

export type TodayPayload = {
  /** The collision takeover. `challenge` outranks `collision`; at most one is set. */
  challenge: TodayChallenge | null;
  collision: TodayCollision | null;
  capture: (CapturedItemSummary & { whyNow: string }) | null;
  connection: TodayConnection | null;
};

/** Small stable hash — the pick must hold steady across reopens within one
 * local day, then move on tomorrow. */
function hashPick(seed: string, size: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % size;
}

function anniversaryPhrase(days: number): string {
  if (days === 30) return "a month ago";
  if (days === 60) return "two months ago";
  return "three months ago";
}

type Row = Parameters<typeof serializeCapturedItem>[0];

/** A display label without the full summary select — the takeover blocks only
 * ever show a title. */
function captureLabel(item: { rawText: string | null; contentItem: { title: string | null } | null } | null): string {
  return item?.contentItem?.title ?? item?.rawText?.replace(/\s+/g, " ").trim().slice(0, 80) ?? "Untitled capture";
}

/**
 * The collision takeover: an unanswered challenge to a staked position, or —
 * failing that — a strong CONTRADICTS edge formed in the last few days. The
 * challenge outranks the edge because it demands a response (revise or hold)
 * where the edge only offers a look, and it holds the surface until answered
 * where the edge merely expires.
 */
async function getCollision(
  userId: string,
  db: DbClient,
  now: Date,
): Promise<Pick<TodayPayload, "challenge" | "collision">> {
  const challenge = await db.positionChallenge.findFirst({
    where: { position: { userId }, acknowledged: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      tension: true,
      position: {
        select: { statement: true, topicId: true, topic: { select: { name: true } } },
      },
      capturedItem: {
        select: { id: true, rawText: true, contentItem: { select: { title: true } } },
      },
    },
  });

  if (challenge) {
    return {
      challenge: {
        challengeId: challenge.id,
        topicId: challenge.position.topicId,
        topicName: challenge.position.topic.name,
        statement: challenge.position.statement,
        tension: challenge.tension,
        capture: challenge.capturedItem
          ? { id: challenge.capturedItem.id, title: captureLabel(challenge.capturedItem) }
          : null,
      },
      collision: null,
    };
  }

  const edge = await db.memoryEdge.findFirst({
    where: {
      userId,
      type: MemoryEdgeType.CONTRADICTS,
      weight: { gte: COLLISION_MIN_WEIGHT },
      createdAt: { gte: new Date(now.getTime() - COLLISION_FRESH_DAYS * DAY_MS) },
    },
    orderBy: { weight: "desc" },
    select: {
      fromItem: { select: { id: true, rawText: true, contentItem: { select: { title: true } } } },
      toItem: { select: { id: true, rawText: true, contentItem: { select: { title: true } } } },
    },
  });

  if (!edge) return { challenge: null, collision: null };
  return {
    challenge: null,
    collision: {
      itemA: { id: edge.fromItem.id, title: captureLabel(edge.fromItem) },
      itemB: { id: edge.toItem.id, title: captureLabel(edge.toItem) },
    },
  };
}

function whyNowLine(summary: CapturedItemSummary, daysAgo: number, anniversary: number | null): string {
  if (anniversary !== null) {
    return `${anniversaryPhrase(anniversary)} today, you saved this. does it still hold?`;
  }
  const topic = [...summary.topics].sort((a, b) => b.weight - a.weight)[0]?.name;
  return topic
    ? `saved ${daysAgo} days ago · filed under ${topic.toLowerCase()}`
    : `saved ${daysAgo} days ago`;
}

export async function getToday(args: {
  userId: string;
  tzOffsetMinutes?: number;
  db?: DbClient;
  now?: Date;
}): Promise<TodayPayload> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();

  // The collision is loaded even below the corpus floor: the floor guards the
  // ritual (there must be a past to hand back), but a challenge to a staked
  // position is an event, not history.
  const takeover = await getCollision(args.userId, db, now);

  const rows = await db.capturedItem.findMany({
    where: { userId: args.userId },
    orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
    take: CAPTURE_SCAN_LIMIT,
    select: captureSummarySelect,
  });

  if (rows.length < MIN_CORPUS) return { ...takeover, capture: null, connection: null };

  const candidates = rows.filter(
    (row) => now.getTime() - row.capturedAt.getTime() >= MIN_AGE_DAYS * DAY_MS,
  );
  if (candidates.length === 0) return { ...takeover, capture: null, connection: null };

  // An anniversary wins; otherwise a day-stable pick across everything old
  // enough, so the ritual rotates through the corpus instead of favouring
  // one corner of it.
  let chosen: Row | null = null;
  let anniversary: number | null = null;
  outer: for (const days of ANNIVERSARIES) {
    const target = now.getTime() - days * DAY_MS;
    for (const candidate of candidates) {
      if (Math.abs(candidate.capturedAt.getTime() - target) <= ANNIVERSARY_TOLERANCE_DAYS * DAY_MS) {
        chosen = candidate;
        anniversary = days;
        break outer;
      }
    }
  }
  if (!chosen) {
    const day = localDayIndex(now, args.tzOffsetMinutes ?? 0);
    chosen = candidates[hashPick(`${args.userId}:${day}`, candidates.length)];
  }

  const summary = serializeCapturedItem(chosen);
  const daysAgo = Math.floor((now.getTime() - chosen.capturedAt.getTime()) / DAY_MS);

  // Strongest edge in either direction (edges are written newer → older), the
  // neighbour's title resolved so the pair reads as two things, not two ids.
  const edges = await db.memoryEdge.findMany({
    where: {
      userId: args.userId,
      OR: [{ fromItemId: chosen.id }, { toItemId: chosen.id }],
    },
    orderBy: { weight: "desc" },
    take: 12,
    select: { fromItemId: true, toItemId: true, type: true, weight: true },
  });

  let connection: TodayConnection | null = null;
  for (const edge of edges) {
    if (edge.weight < EDGE_MIN_WEIGHT) break;
    const neighbourId = edge.fromItemId === chosen.id ? edge.toItemId : edge.fromItemId;
    if (neighbourId === chosen.id) continue;
    const neighbour = await db.capturedItem.findFirst({
      where: { id: neighbourId, userId: args.userId },
      select: captureSummarySelect,
    });
    if (!neighbour) continue;
    connection = {
      itemId: neighbourId,
      title: serializeCapturedItem(neighbour).title,
      type: edge.type as string,
      weight: edge.weight,
    };
    break;
  }

  return { ...takeover, capture: { ...summary, whyNow: whyNowLine(summary, daysAgo, anniversary) }, connection };
}
