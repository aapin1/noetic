import { MemoryEdgeType, NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isGeneralTopic } from "@/server/cognition/generalTopics";
import type { DbClient } from "@/server/db";
import {
  findConvergenceCandidates,
  findDormantThreads,
  groupCapturesByTopic,
  rankByActivity,
  type LoadedCapture,
} from "@/server/services/intelligence";
import { rankTopicMomentum } from "@/server/services/memory";
import { createNotification } from "@/server/services/notifications";

/**
 * The resurfacing engine: pick the single most interesting *unseen* thing about
 * a user's own thinking, and say it in one sentence worth opening the app for.
 *
 * Everything here is structural — CONTRADICTS edges, capture rates, dormancy,
 * source spread. It deliberately makes NO LLM calls: this path may run for every
 * user on the platform in one sweep, and a per-user model call would turn a free
 * job into a recurring bill. The prose Mind shows is already cached and already
 * paid for; what a push needs is the *fact*, and the facts are all in the DB.
 */

/** Types this engine owns — used to enforce the daily cap and read dedupe keys. */
export const RESURFACE_TYPES = [
  NotificationType.CONTRADICTION_FOUND,
  NotificationType.THREAD_MOMENTUM,
  NotificationType.DORMANT_REVIVAL,
  NotificationType.RESURFACE,
] as const;

/** Below this, a user has not written enough for us to say anything true. */
const MIN_CORPUS = 5;
/** The weakest tier (an old capture) needs a real corpus to not feel arbitrary. */
const MIN_CORPUS_FOR_ANNIVERSARY = 12;
const CAPTURE_SCAN_LIMIT = 200;
/** One push per user per day, measured from the last one we created. */
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Momentum windows — same shape memory.ts uses for the "rising" topic. */
const MOMENTUM_RECENT_DAYS = 7;
const MOMENTUM_PRIOR_DAYS = 30;
/** A topic must be accelerating meaningfully, not just wobbling. */
const MOMENTUM_MIN_LIFT = 1.6;
/**
 * A topic must also have existed before the recent window to be "picking up".
 *
 * The lift formula smooths a zero prior into a large finite number, which is
 * right for ranking but wrong as a claim: a brand-new user who saves six things
 * about attention in their first week has infinite lift on every topic they
 * own, and telling them "attention is picking up" only narrates what they just
 * did. Acceleration needs something to accelerate from.
 */
const MOMENTUM_MIN_PRIOR = 1;
/** Anniversaries we mark, in days. */
const ANNIVERSARIES = [30, 60, 90];
/** How close to the mark a capture must sit to count as "a month ago". */
const ANNIVERSARY_TOLERANCE_DAYS = 2;
/** Don't sweep accounts that have been gone for a season. */
const SWEEP_ACTIVE_WITHIN_DAYS = 90;

export type ResurfaceCandidate = {
  type: NotificationType;
  /** Stable identity of the underlying thing. Stored on the notification's
   * payload as `resurfaceKey` and checked before enqueueing, so the same
   * contradiction or the same dormant thread is never sent twice. */
  key: string;
  title: string;
  body: string;
  deepLink: string;
  payload: Record<string, unknown>;
};

/** Trim a capture title down to something that fits on a lock screen. */
function short(label: string, max = 52): string {
  const clean = label.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function monthName(date: Date): string {
  return date.toLocaleString("en-US", { month: "long" }).toLowerCase();
}

function anniversaryPhrase(days: number): string {
  if (days === 30) return "a month ago";
  if (days === 60) return "two months ago";
  return "three months ago";
}

async function loadCaptures(userId: string, db: DbClient): Promise<LoadedCapture[]> {
  const rows = await db.capturedItem.findMany({
    where: { userId },
    orderBy: { capturedAt: "desc" },
    take: CAPTURE_SCAN_LIMIT,
    // Only what the pure helpers below read. Never `include` here: that pulls
    // embeddings and full article bodies, which is megabytes per user and this
    // runs across the whole user base in one sweep.
    select: {
      id: true,
      rawText: true,
      capturedAt: true,
      contentItem: {
        select: {
          title: true,
          siteName: true,
          source: { select: { name: true } },
        },
      },
      topics: { select: { topicId: true, topic: { select: { name: true } } } },
    },
  });

  return rows.map((item) => ({
    id: item.id,
    label: item.contentItem?.title ?? item.rawText?.slice(0, 80) ?? "Untitled capture",
    rawText: item.rawText,
    // The selection path never grounds an LLM, so the expensive gist fields are
    // deliberately not loaded — nothing downstream of here reads them.
    gist: "",
    keyIdea: null,
    capturedAt: item.capturedAt,
    sourceName: item.contentItem?.source?.name ?? item.contentItem?.siteName ?? null,
    topics: item.topics.map((row) => ({ topicId: row.topicId, name: row.topic.name })),
  }));
}

/**
 * Every resurfacing key this user has already been sent.
 *
 * Kept in `Notification.payload.resurfaceKey` rather than a dedicated table —
 * the notification row is already the permanent record that we told someone
 * something, so a second table tracking the same fact would only be a way for
 * the two to disagree.
 */
async function loadSeenKeys(userId: string, db: DbClient): Promise<Set<string>> {
  const rows = await db.notification.findMany({
    where: { recipientId: userId, type: { in: [...RESURFACE_TYPES] } },
    select: { payload: true },
  });

  const seen = new Set<string>();
  for (const row of rows) {
    const payload = row.payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const key = (payload as Record<string, unknown>).resurfaceKey;
      if (typeof key === "string") seen.add(key);
    }
  }
  return seen;
}

/**
 * Pick the one thing worth telling this user, or null.
 *
 * Null is a real answer and by far the most common one. A weak push is worse
 * than no push: it teaches people that the app's notifications aren't worth
 * opening, which is the exact failure this whole feature exists to avoid.
 */
export async function selectResurfaceCandidate(args: {
  userId: string;
  db?: DbClient;
  now?: Date;
}): Promise<ResurfaceCandidate | null> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();

  // Daily cap, enforced against what we actually created — not against what
  // was delivered, so a send failure can't turn into a second attempt tomorrow
  // plus today's, arriving together.
  const recent = await db.notification.findFirst({
    where: {
      recipientId: args.userId,
      type: { in: [...RESURFACE_TYPES] },
      createdAt: { gte: new Date(now.getTime() - DAILY_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return null;

  const [captures, seen] = await Promise.all([
    loadCaptures(args.userId, db),
    loadSeenKeys(args.userId, db),
  ]);

  if (captures.length < MIN_CORPUS) return null;

  const byId = new Map(captures.map((c) => [c.id, c]));
  const allGroups = groupCapturesByTopic(captures, 2);
  const activeGroups = rankByActivity(allGroups, now);

  // ── 1. a fresh contradiction ──────────────────────────────────────────────
  // The strongest thing Mneme can say. Two things you believed, that don't fit.
  const edges = await db.memoryEdge.findMany({
    where: { userId: args.userId, type: MemoryEdgeType.CONTRADICTS },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      fromItemId: true,
      toItemId: true,
      fromItem: { select: { rawText: true, contentItem: { select: { title: true } } } },
      toItem: { select: { rawText: true, contentItem: { select: { title: true } } } },
    },
  });

  for (const edge of edges) {
    const key = `contradiction:${edge.fromItemId}:${edge.toItemId}`;
    const mirrored = `contradiction:${edge.toItemId}:${edge.fromItemId}`;
    if (seen.has(key) || seen.has(mirrored)) continue;

    const labelA = short(edge.fromItem.contentItem?.title ?? edge.fromItem.rawText ?? "one of your captures", 40);
    const labelB = short(edge.toItem.contentItem?.title ?? edge.toItem.rawText ?? "another", 40);

    // Name the topic they share — "about attention" is what makes this a
    // reason to open the app rather than a notification about notifications.
    const a = byId.get(edge.fromItemId);
    const b = byId.get(edge.toItemId);
    const sharedTopic = a && b
      ? a.topics.find((t) => b.topics.some((other) => other.topicId === t.topicId))
      : undefined;

    return {
      type: NotificationType.CONTRADICTION_FOUND,
      key,
      title: sharedTopic
        ? `two things you saved about ${sharedTopic.name.toLowerCase()} disagree`
        : "two things you saved disagree",
      body: `“${labelA}” and “${labelB}”. see where they split.`,
      deepLink: "/(tabs)/mind",
      payload: { resurfaceKey: key, itemAId: edge.fromItemId, itemBId: edge.toItemId },
    };
  }

  // ── 2. a thread gaining momentum ──────────────────────────────────────────
  const momentum = rankTopicMomentum(
    captures.map((c) => ({ capturedAt: c.capturedAt, topics: c.topics })),
    { recentDays: MOMENTUM_RECENT_DAYS, priorDays: MOMENTUM_PRIOR_DAYS, now: now.getTime() },
  );

  for (const topic of momentum) {
    if (topic.lift < MOMENTUM_MIN_LIFT) break;
    // General fields ("philosophy") are always the biggest and always the most
    // recently fed — telling someone their "technology" topic is accelerating
    // is noise. Only specific threads are worth waking a phone for.
    if (isGeneralTopic(topic.name)) continue;
    if (topic.prior < MOMENTUM_MIN_PRIOR) continue;
    const key = `momentum:${topic.topicId}`;
    if (seen.has(key)) continue;

    return {
      type: NotificationType.THREAD_MOMENTUM,
      key,
      title: `${topic.name.toLowerCase()} is picking up`,
      body: "you've been circling it all week. mneme pulled the thread together.",
      deepLink: "/(tabs)/mind",
      payload: { resurfaceKey: key, topicId: topic.topicId },
    };
  }

  // ── 3. a topic crossing into dormancy ─────────────────────────────────────
  const dormant = findDormantThreads(
    // Same filter intelligence.ts applies: a coarse field can't go dormant
    // while you keep reading anything nearby.
    activeGroups.filter((g) => !isGeneralTopic(g.topicName)),
    now,
  );

  for (const thread of dormant) {
    const key = `dormant:${thread.topicId}`;
    if (seen.has(key)) continue;

    return {
      type: NotificationType.DORMANT_REVIVAL,
      key,
      title: `you left ${thread.topicName.toLowerCase()} unfinished`,
      body: `nothing new since ${monthName(new Date(thread.lastCapturedAt))}. the thread is still there.`,
      deepLink: `/archive/${thread.topicId}`,
      payload: { resurfaceKey: key, topicId: thread.topicId },
    };
  }

  // ── 4. a convergence signal ───────────────────────────────────────────────
  // Note the departure from Mind, which lets coarse fields fill spare slots so
  // the screen is never empty. A push has no slots to fill: "philosophy keeps
  // finding you" is not worth a notification, so generals are dropped outright.
  const convergent = findConvergenceCandidates(activeGroups)
    .filter((g) => !isGeneralTopic(g.topicName))
    .slice(0, 5);

  for (const group of convergent) {
    const key = `convergence:${group.topicId}`;
    if (seen.has(key)) continue;

    const sources = [...new Set(group.captures.map((c) => c.sourceName).filter(Boolean))] as string[];
    if (sources.length < 2) continue;

    return {
      type: NotificationType.RESURFACE,
      key,
      title: `${group.topicName.toLowerCase()} keeps finding you`,
      body: `${short(sources[0], 24)} and ${short(sources[1], 24)} are pointing the same way.`,
      deepLink: "/(tabs)/mind",
      payload: { resurfaceKey: key, topicId: group.topicId },
    };
  }

  // ── 5. something you saved a while back ───────────────────────────────────
  // The floor, not the goal: only reached when nothing above fired, and only
  // for someone with enough history that a 30-day-old capture means something.
  if (captures.length < MIN_CORPUS_FOR_ANNIVERSARY) return null;

  for (const days of ANNIVERSARIES) {
    const target = now.getTime() - days * DAY_MS;
    const match = captures.find((c) => {
      const delta = Math.abs(c.capturedAt.getTime() - target);
      return delta <= ANNIVERSARY_TOLERANCE_DAYS * DAY_MS;
    });
    if (!match) continue;

    const key = `resurface:${match.id}`;
    if (seen.has(key)) continue;

    return {
      type: NotificationType.RESURFACE,
      key,
      title: `${anniversaryPhrase(days)}, you saved this`,
      body: `“${short(match.label)}”. does it still hold?`,
      deepLink: `/insight/${match.id}`,
      payload: { resurfaceKey: key, captureId: match.id },
    };
  }

  return null;
}

/**
 * Select for one user and enqueue the result as a PENDING notification.
 * Returns the candidate that was queued, or null when there was nothing worth
 * saying. Actual transmission is the dispatch drain's job.
 */
export async function enqueueResurfaceFor(args: {
  userId: string;
  db?: DbClient;
  now?: Date;
}): Promise<ResurfaceCandidate | null> {
  const db = args.db ?? prisma;
  const candidate = await selectResurfaceCandidate(args);
  if (!candidate) return null;

  await createNotification({
    db,
    recipientId: args.userId,
    type: candidate.type,
    title: candidate.title,
    body: candidate.body,
    deepLink: candidate.deepLink,
    payload: candidate.payload,
  });

  return candidate;
}

export type ResurfaceSweepResult = {
  considered: number;
  queued: number;
};

/**
 * Run selection across everyone who could actually receive a push.
 *
 * Scoped to users with a live Expo token and some activity this season: there
 * is no point selecting for an account that cannot be reached, and no point
 * waking one that left months ago.
 */
export async function runResurfaceSweep(args: {
  db?: DbClient;
  now?: Date;
  limit?: number;
} = {}): Promise<ResurfaceSweepResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const activeSince = new Date(now.getTime() - SWEEP_ACTIVE_WITHIN_DAYS * DAY_MS);

  const users = await db.user.findMany({
    where: {
      deviceTokens: { some: { isActive: true, provider: "EXPO" } },
      capturedItems: { some: { capturedAt: { gte: activeSince } } },
    },
    select: { id: true },
    ...(args.limit ? { take: args.limit } : {}),
  });

  let queued = 0;
  for (const user of users) {
    try {
      const candidate = await enqueueResurfaceFor({ userId: user.id, db, now });
      if (candidate) queued += 1;
    } catch (error) {
      // One user's bad data must never stop the sweep for everyone else.
      console.error("[resurface] selection failed", user.id, error);
    }
  }

  return { considered: users.length, queued };
}
