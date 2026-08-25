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
import { clampOffset, dueThisHourWhere } from "@/server/services/notification-policy";
import { createNotification } from "@/server/services/notifications";
import { localDayIndex } from "@/server/services/streak";

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
  NotificationType.NUDGE,
] as const;

/** Below this, a user has not written enough for us to say anything true. */
const MIN_CORPUS = 5;
/**
 * Below this the app is still mostly a promise: the map has little to connect
 * and most observation tiers cannot fire. Getting a user here is the hard part,
 * so under it the engine nudges toward capturing rather than staying silent.
 * Matches TERRAIN_FORMING_MIN — the point at which the You page starts to show
 * the long view forming.
 */
export const GROWTH_TARGET = 15;
/** Growth prompts speak every other day, never daily. */
const GROWTH_EVERY_DAYS = 2;
/** Never nudge someone who captured this recently — they are plainly active. */
const EARLY_MIN_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * Days quiet at which the inactivity ladder speaks — once per rung, per
 * absence. After the last rung the account is left alone; the sweep's own
 * activity window retires it not long after.
 */
export const INACTIVITY_RUNGS = [3, 7, 14, 30] as const;
/** An account that has never captured is nudged for this long after signup. */
const NEVER_CAPTURED_WINDOW_DAYS = 30;
/** The weakest tier (an old capture) needs a real corpus to not feel arbitrary. */
const MIN_CORPUS_FOR_ANNIVERSARY = 12;
const CAPTURE_SCAN_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One push per user per day, measured from the last one we created.
 *
 * Twenty hours rather than twenty-four, and the four hours are the point. The
 * sweep runs at a fixed local hour, so yesterday's push was created at very
 * nearly this time yesterday — a full-day window would race its own schedule
 * and block today's selection whenever the job started a few seconds early,
 * costing the user a day at random and looking like nothing at all in the logs.
 * Twenty hours is comfortably clear of that and still cannot fit two pushes
 * into one waking day.
 */
const SAME_DAY_WINDOW_MS = 20 * 60 * 60 * 1000;
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
 * When the user was last here, in their own days.
 *
 * "Here" is a capture or a /today visit — the two things the app records —
 * plus signup, so a brand-new account with nothing in it still has a day to
 * measure from. Both reads are best-effort: the sweep's fake databases and an
 * account that predates the preferences row must both resolve to "unknown",
 * which the re-engagement tiers read as "say nothing".
 */
async function loadActivity(
  userId: string,
  db: DbClient,
): Promise<{ tzOffsetMinutes: number; activityDays: number[]; signupAt: Date | null }> {
  let prefs: { tzOffsetMinutes: number | null; streakActivityDays: number[] } | null = null;
  try {
    prefs = await db.userPreference.findUnique({
      where: { userId },
      select: { tzOffsetMinutes: true, streakActivityDays: true },
    });
  } catch {
    prefs = null;
  }
  let user: { createdAt: Date } | null = null;
  try {
    user = await db.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  } catch {
    user = null;
  }
  return {
    tzOffsetMinutes: clampOffset(prefs?.tzOffsetMinutes),
    activityDays: prefs?.streakActivityDays ?? [],
    signupAt: user?.createdAt ?? null,
  };
}

/**
 * Where this account stands against the floors, as one honest sentence. The
 * numbers are the real ones: MIN_CORPUS is where observations begin and
 * GROWTH_TARGET is where the map starts connecting, so the promise made here
 * is one the app keeps.
 */
function progressLine(count: number): string {
  if (count < MIN_CORPUS) return `${count} of ${MIN_CORPUS} — mneme starts noticing patterns at ${MIN_CORPUS}.`;
  return `${count} of ${GROWTH_TARGET} — the map starts connecting at ${GROWTH_TARGET}.`;
}

function quietPhrase(rung: number): string {
  if (rung <= 3) return "three days";
  if (rung <= 7) return "a week";
  if (rung <= 14) return "two weeks";
  return "a month";
}

/**
 * The growth prompts, rotated by day so a user sees each in turn. Every one is
 * a question about what they have been reading — the thing to do next — never
 * about what they saved before, which has not changed since they saw it.
 */
const GROWTH_PROMPTS: { title: string; lead: string }[] = [
  { title: "read or watched anything cool recently?", lead: "one capture is enough." },
  { title: "what's the best thing you read this week?", lead: "save it before it slips." },
  { title: "saved anything you disagreed with lately?", lead: "disagreement is where mneme gets interesting." },
  { title: "a podcast, a thread, a page of a book", lead: "anything counts." },
];

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
 * Null is a real answer and, past the growth target, by far the most common
 * one. A weak push is worse than no push: it teaches people that the app's
 * notifications aren't worth opening, which is the exact failure this whole
 * feature exists to avoid. Under the target the calculus flips — the app has
 * nothing to show yet, and the only push that helps is the one that gets them
 * to the point where it does.
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
  //
  // STREAK_HELD is in this list, and that is the arbitration rule: a streak
  // push already queued today takes the day's slot, and this returns null
  // BEFORE any candidate is selected. That ordering is the whole point. A
  // resurfacing candidate is "used up" the moment its notification row exists,
  // because loadSeenKeys reads every row regardless of status — so losing the
  // slot after selection would silently burn a contradiction the user never
  // saw. Losing it before selection costs nothing: the same contradiction is
  // just as interesting tomorrow, which is precisely why it yields and the
  // perishable streak push does not.
  const recent = await db.notification.findFirst({
    where: {
      recipientId: args.userId,
      type: { in: [...RESURFACE_TYPES, NotificationType.STREAK_HELD] },
      createdAt: { gte: new Date(now.getTime() - SAME_DAY_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recent) return null;

  const [captures, seen, activity] = await Promise.all([
    loadCaptures(args.userId, db),
    loadSeenKeys(args.userId, db),
    loadActivity(args.userId, db),
  ]);

  // The user's last day here, or null when we have no clock to measure from.
  const tz = activity.tzOffsetMinutes;
  const todayIdx = localDayIndex(now, tz);
  const lastActiveDay = Math.max(
    captures[0] ? localDayIndex(captures[0].capturedAt, tz) : -Infinity,
    activity.activityDays.length ? Math.max(...activity.activityDays) : -Infinity,
    activity.signupAt ? localDayIndex(activity.signupAt, tz) : -Infinity,
  );
  const daysQuiet = Number.isFinite(lastActiveDay) ? todayIdx - lastActiveDay : null;

  // ── 0. a challenge to a staked position ───────────────────────────────────
  // Above every other tier, and above the corpus floor: the floor exists
  // because a thin corpus can't support a true observation, but a challenge is
  // not an observation — the user staked a statement, a capture collided with
  // it, and evaluatePositionTension already judged the collision real. This is
  // the one push that names a commitment rather than a pattern.
  const challenge = await db.positionChallenge.findFirst({
    where: { position: { userId: args.userId }, acknowledged: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      position: { select: { topicId: true, topic: { select: { name: true } } } },
      capturedItem: { select: { rawText: true, contentItem: { select: { title: true } } } },
    },
  });

  if (challenge) {
    const key = `position-challenge:${challenge.id}`;
    if (!seen.has(key)) {
      const label = short(
        challenge.capturedItem?.contentItem?.title
          ?? challenge.capturedItem?.rawText
          ?? "something you just saved",
        40,
      );
      return {
        type: NotificationType.CONTRADICTION_FOUND,
        key,
        title: `a new capture challenges your position on ${challenge.position.topic.name.toLowerCase()}`,
        body: `“${label}” pushes against what you staked. revise or hold.`,
        // The /today ritual, where the collision takes over the surface and
        // carries its revise/hold response. Opening it credits the day.
        deepLink: "/today",
        payload: { resurfaceKey: key, challengeId: challenge.id, topicId: challenge.position.topicId },
      };
    }
  }

  // ── the re-engagement fallback ────────────────────────────────────────────
  // Reached whenever no observation is left to make. Neither of these is an
  // observation — they are invitations — and an invitation is always weaker
  // than a true thing about the user's own thinking, so every observational
  // tier is tried first.
  //
  // The inactivity ladder speaks at fixed rungs of absence, once each: the
  // highest rung reached whose key is unseen, so a tick that was missed (or
  // spent on an observation) cannot stack up into several. A return resets
  // the ladder, because the key is bound to the day they left. The growth
  // prompt covers the days in between for accounts still under the target.
  const reengage = (): ResurfaceCandidate | null => {
    if (daysQuiet !== null) {
      const rung = [...INACTIVITY_RUNGS].reverse().find((r) => daysQuiet >= r);
      const withinWindow = captures.length > 0 || daysQuiet <= NEVER_CAPTURED_WINDOW_DAYS;
      if (rung !== undefined && withinWindow) {
        const key = `inactive:${rung}:${lastActiveDay}`;
        if (!seen.has(key)) return inactivityCandidate({ key, rung, captures, now });
      }
    }
    return growthCandidate({ captures, seen, todayIdx, daysQuiet, now });
  };

  // Under the floor nothing observational can be true, but an invitation
  // toward the floor can be.
  if (captures.length < MIN_CORPUS) return reengage();

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
  if (captures.length < MIN_CORPUS_FOR_ANNIVERSARY) return reengage();

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
      // The /today ritual screen, not the bare insight: it carries the same
      // capture plus its strongest edge, and opening it credits the day.
      deepLink: "/today",
      payload: { resurfaceKey: key, captureId: match.id },
    };
  }

  return reengage();
}

/**
 * The inactivity push. For an account with enough to show, it names the thread
 * they were building and points at it; for a thin one, it asks the only
 * question that moves them forward — what have you been reading — and says
 * honestly how far they are from the app getting interesting.
 */
function inactivityCandidate(args: {
  key: string;
  rung: number;
  captures: LoadedCapture[];
  now: Date;
}): ResurfaceCandidate {
  const { key, rung, captures, now } = args;
  const quiet = quietPhrase(rung);
  const base = { type: NotificationType.NUDGE, key };

  if (captures.length >= GROWTH_TARGET) {
    const [top] = rankByActivity(groupCapturesByTopic(captures, 2), now)
      .filter((g) => !isGeneralTopic(g.topicName));
    if (top) {
      return {
        ...base,
        title: `you were building something on ${top.topicName.toLowerCase()}`,
        body: `${quiet} quiet, and it's still there. read anything since?`,
        deepLink: `/archive/${top.topicId}`,
        payload: { resurfaceKey: key, kind: "inactive", days: rung, topicId: top.topicId },
      };
    }
  }

  return {
    ...base,
    title: "read or watched anything cool recently?",
    body: captures.length === 0
      ? `${quiet} since you joined and nothing captured yet. one is enough to start.`
      : `${quiet} since your last capture. ${progressLine(captures.length)}`,
    deepLink: "/(tabs)",
    payload: { resurfaceKey: key, kind: "inactive", days: rung, captures: captures.length },
  };
}

/**
 * The growth prompt: every other day, for an account still under the target,
 * when nothing truer fired. Never for someone who is plainly active (captured
 * within twelve hours, or here today), and never once the inactivity ladder
 * has taken over — that is a different conversation.
 */
function growthCandidate(args: {
  captures: LoadedCapture[];
  seen: Set<string>;
  todayIdx: number;
  daysQuiet: number | null;
  now: Date;
}): ResurfaceCandidate | null {
  const { captures, seen, todayIdx, daysQuiet, now } = args;
  if (captures.length >= GROWTH_TARGET) return null;
  if (daysQuiet === null || daysQuiet < 1) return null;
  if (daysQuiet >= INACTIVITY_RUNGS[0]) return null;
  if (captures[0] && now.getTime() - captures[0].capturedAt.getTime() < EARLY_MIN_AGE_MS) return null;

  const bucket = Math.floor(todayIdx / GROWTH_EVERY_DAYS);
  const key = `growth:${bucket}`;
  if (seen.has(key)) return null;

  const prompt = GROWTH_PROMPTS[bucket % GROWTH_PROMPTS.length]!;
  return {
    type: NotificationType.NUDGE,
    key,
    title: prompt.title,
    body: captures.length === 0
      ? `${prompt.lead} nothing captured yet — the first one starts the map.`
      : `${prompt.lead} ${progressLine(captures.length)}`,
    deepLink: "/(tabs)",
    payload: { resurfaceKey: key, kind: "growth", captures: captures.length },
  };
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
 * Run selection across everyone who could actually receive a push, and for whom
 * it is currently the send hour locally.
 *
 * Scoped four ways, each of which removes work rather than adding it: a live
 * Expo token (no point selecting for an account that cannot be reached), some
 * activity this season (no point waking one that left months ago), resurfacing
 * pushes not switched off, and the local-hour window that turns an hourly cron
 * into a daily-per-user sweep. On any given run this is roughly a
 * twenty-fourth of the eligible base.
 */
export async function runResurfaceSweep(args: {
  db?: DbClient;
  now?: Date;
  limit?: number;
  /**
   * Users the caller has already spent today's push on. The hourly job passes
   * everyone whose streak was just held: streak beats resurfacing, and skipping
   * them here means the candidate is never selected, never written, and so
   * never marked seen. It stays eligible for tomorrow.
   */
  skipUserIds?: Iterable<string>;
  /** Pre-resolved candidates, already scoped and filtered by the caller. The
   * hourly job resolves both sweeps' user sets in one read. */
  userIds?: string[];
} = {}): Promise<ResurfaceSweepResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const activeSince = new Date(now.getTime() - SWEEP_ACTIVE_WITHIN_DAYS * DAY_MS);
  const skip = new Set(args.skipUserIds ?? []);

  const found = args.userIds
    ? args.userIds.map((id) => ({ id }))
    : await db.user.findMany({
        where: {
          deviceTokens: { some: { isActive: true, provider: "EXPO" } },
          capturedItems: { some: { capturedAt: { gte: activeSince } } },
          ...dueThisHourWhere(now, "resurface"),
        },
        select: { id: true },
        ...(args.limit ? { take: args.limit } : {}),
      });

  const users = skip.size > 0 ? found.filter((user) => !skip.has(user.id)) : found;

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
