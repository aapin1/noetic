import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { isGeneralTopic } from "@/server/cognition/generalTopics";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Rolling window for "what you have newly broken into". */
const DISCOVERY_WINDOW_DAYS = 45;
/** Capped server-side so the client renders the list as given. */
const DISCOVERY_LIMIT = 8;

export const ARC_SIZES = { hours: 24, days: 30, weeks: 12, months: 6 } as const;

export interface ArcBucket {
  /** Short axis label, already localised to the caller's clock. */
  label: string;
  count: number;
}

/** The same history bucketed four ways so the client can zoom the timeline. */
export interface WrappedArcs {
  hours: ArcBucket[];
  days: ArcBucket[];
  weeks: ArcBucket[];
  months: ArcBucket[];
}

export interface WrappedStats {
  totalCaptures: number;
  firstCaptureAt: string | null;
  daysSinceFirst: number;
  distinctTopics: number;
  /** Coarse fields (general topics), most-captured first. */
  topFields: { name: string; count: number }[];
  /** Specific sub-topics, most-captured first. */
  topTopics: { name: string; count: number }[];
  /** The specific sub-topics you've most recently broken into, oldest first —
   * already capped, so the client renders the list as given. */
  recentNewTopics: string[];
  busiestDayOfWeek: string | null;
  busiestHour: number | null;
  /** Captures per hour of day (0–23) and per weekday (index 0 = Sunday). */
  hourHistogram: number[];
  weekdayHistogram: number[];
  formats: { name: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  /** Days inside the live run that a freeze covered. Zero for almost everyone;
   * non-zero is what lets the You page say "we held the 14th for you" — always
   * after the fact, never as a warning. */
  streakHeldDays: number;
  arcs: WrappedArcs;
  followingCount: number;
  followerCount: number;
  /** People this user follows who've captured something in the last 7 days, busiest first. */
  friendActivity: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    count: number;
    /** What they've actually been on this week — up to two sub-topics. */
    topics: string[];
  }[];
}

/**
 * Bucketing runs on the caller's wall clock, not the server's. Shifting the
 * epoch by the client's UTC offset lets the plain `getUTC*` accessors read back
 * local calendar fields, so "Tuesdays around 3pm" means 3pm where the user is.
 */
function clampOffset(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(minutes)));
}

function shortHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** Epoch day index of the Sunday that starts the week containing `dayIdx`. */
function weekStart(dayIdx: number): number {
  return dayIdx - ((dayIdx + 4) % 7);
}

function countTop(mentions: string[], limit: number): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of mentions) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function buildArcs(localMsList: number[], nowLocalMs: number): WrappedArcs {
  const nowHour = Math.floor(nowLocalMs / HOUR_MS);
  const nowDay = Math.floor(nowLocalMs / DAY_MS);
  const nowWeek = weekStart(nowDay);
  const now = new Date(nowLocalMs);
  const nowMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();

  const hourCounts = new Array<number>(ARC_SIZES.hours).fill(0);
  const dayCounts = new Array<number>(ARC_SIZES.days).fill(0);
  const weekCounts = new Array<number>(ARC_SIZES.weeks).fill(0);
  const monthCounts = new Array<number>(ARC_SIZES.months).fill(0);

  for (const ms of localMsList) {
    const at = new Date(ms);

    const hoursAgo = nowHour - Math.floor(ms / HOUR_MS);
    if (hoursAgo >= 0 && hoursAgo < ARC_SIZES.hours) {
      hourCounts[ARC_SIZES.hours - 1 - hoursAgo] += 1;
    }

    const dayIdx = Math.floor(ms / DAY_MS);
    const daysAgo = nowDay - dayIdx;
    if (daysAgo >= 0 && daysAgo < ARC_SIZES.days) {
      dayCounts[ARC_SIZES.days - 1 - daysAgo] += 1;
    }

    const weeksAgo = (nowWeek - weekStart(dayIdx)) / 7;
    if (weeksAgo >= 0 && weeksAgo < ARC_SIZES.weeks) {
      weekCounts[ARC_SIZES.weeks - 1 - weeksAgo] += 1;
    }

    const monthsAgo = nowMonth - (at.getUTCFullYear() * 12 + at.getUTCMonth());
    if (monthsAgo >= 0 && monthsAgo < ARC_SIZES.months) {
      monthCounts[ARC_SIZES.months - 1 - monthsAgo] += 1;
    }
  }

  const hours = hourCounts.map((count, i) => {
    const hour = (((nowHour - (ARC_SIZES.hours - 1 - i)) % 24) + 24) % 24;
    return { label: shortHour(hour), count };
  });

  const days = dayCounts.map((count, i) => {
    const at = new Date((nowDay - (ARC_SIZES.days - 1 - i)) * DAY_MS);
    return { label: String(at.getUTCDate()), count };
  });

  const weeks = weekCounts.map((count, i) => {
    const at = new Date((nowWeek - (ARC_SIZES.weeks - 1 - i) * 7) * DAY_MS);
    return { label: `${at.getUTCMonth() + 1}/${at.getUTCDate()}`, count };
  });

  const months = monthCounts.map((count, i) => {
    const idx = nowMonth - (ARC_SIZES.months - 1 - i);
    return { label: MONTHS_SHORT[((idx % 12) + 12) % 12], count };
  });

  return { hours, days, weeks, months };
}

/**
 * `todayIdx` is the caller's local day. A streak is only "current" while it is
 * still alive — the run has to reach today, or yesterday (today isn't over, so
 * not having captured yet doesn't break it). Without that anchor the run ending
 * at the LAST active day was reported forever: skip a week and the card still
 * claimed the streak you had before the gap.
 *
 * `frozenDays` are local days a streak freeze has covered (see services/streak.ts).
 * A frozen day **bridges** a run without **counting** toward it: Mon–Wed captured,
 * Thu frozen, Fri captured reads as 4, not 5. Both properties matter.
 *
 *  - Bridging keeps the run alive, which is the entire point of a freeze.
 *  - Not counting keeps the number honest: it is always a count of days on which
 *    something was actually saved.
 *
 * Crucially the same rule governs `longest`, so `current` can never exceed it.
 * `current` is by construction the length of one of the runs `longest` maximises
 * over, which makes the impossible pair (current 15 / longest 12) unreachable
 * rather than merely unlikely.
 */
export function computeStreaks(
  localDayIndices: number[],
  todayIdx: number,
  frozenDays: number[] = [],
): { current: number; longest: number; held: number } {
  const captureDays = new Set(localDayIndices);
  if (captureDays.size === 0) {
    return { current: 0, longest: 0, held: 0 };
  }

  // A freeze on a day that was captured anyway is a no-op, and one dated in the
  // future is clock skew — neither should be able to bridge anything.
  const covered = [
    ...new Set([
      ...captureDays,
      ...frozenDays.filter((day) => !captureDays.has(day) && day <= todayIdx),
    ]),
  ].sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of covered) {
    // A gap that no freeze covers ends the run; a frozen day carries it across.
    if (prev !== null && day !== prev + 1) run = 0;
    if (captureDays.has(day)) run += 1;
    longest = Math.max(longest, run);
    prev = day;
  }

  const lastCovered = covered[covered.length - 1];
  if (lastCovered < todayIdx - 1) {
    return { current: 0, longest, held: 0 };
  }

  // Current streak = the contiguous covered block ending at the most recent
  // covered day, which the guard above has established is today or yesterday.
  let current = 0;
  let held = 0;
  prev = null;
  for (let i = covered.length - 1; i >= 0; i -= 1) {
    const day = covered[i];
    if (prev !== null && day !== prev - 1) break;
    if (captureDays.has(day)) current += 1;
    else held += 1;
    prev = day;
  }

  return { current, longest, held };
}

/**
 * Local days a freeze has already covered for this user.
 *
 * Defensive on purpose: a preferences row that is missing, or a read that
 * fails, means "no freezes" — never a broken You page. The streak is a garnish
 * on this endpoint, not its reason for existing.
 */
async function loadFrozenDays(userId: string, db: DbClient): Promise<number[]> {
  try {
    const prefs = await db.userPreference?.findUnique({
      where: { userId },
      select: { streakFrozenDays: true },
    });
    return prefs?.streakFrozenDays ?? [];
  } catch {
    return [];
  }
}

/** Captures scanned across everyone you follow for the week's activity. */
const FRIEND_CAPTURE_SCAN = 600;

async function getSocialWrappedStats(
  userId: string,
  db: DbClient,
): Promise<Pick<WrappedStats, "followingCount" | "followerCount" | "friendActivity">> {
  const profileSelect = { handle: true, displayName: true, avatarUrl: true } as const;

  const following = await db.follow.findMany({
    where: { followerId: userId },
    select: {
      following: { select: { id: true, profile: { select: profileSelect } } },
    },
  });

  const followerCount = await db.follow.count({ where: { followingId: userId } });

  let friendActivity: WrappedStats["friendActivity"] = [];
  if (following.length > 0) {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const followingIds = following.map((f) => f.following.id);
    const recentCaptures = await db.capturedItem.findMany({
      where: { userId: { in: followingIds }, capturedAt: { gte: since } },
      orderBy: { capturedAt: "desc" },
      take: FRIEND_CAPTURE_SCAN,
      select: {
        userId: true,
        user: { select: { profile: { select: profileSelect } } },
        topics: { select: { topic: { select: { name: true } } } },
      },
    });

    // A bare count says someone was busy but not what with, which is the only
    // part that makes you want to go look. Track what they were actually on.
    type Tally = WrappedStats["friendActivity"][number] & { mentions: string[] };
    const counts = new Map<string, Tally>();
    for (const capture of recentCaptures) {
      // Specific sub-topics say something ("stoicism"); the coarse field it sits
      // under mostly doesn't. Fall back to the field when that's all there is.
      const names = capture.topics.map((row) => row.topic.name);
      const mentions = names.filter((name) => !isGeneralTopic(name));
      const existing = counts.get(capture.userId);
      if (existing) {
        existing.count += 1;
        existing.mentions.push(...(mentions.length > 0 ? mentions : names));
      } else {
        counts.set(capture.userId, {
          handle: capture.user.profile?.handle ?? capture.userId,
          displayName: capture.user.profile?.displayName ?? "Unknown",
          avatarUrl: capture.user.profile?.avatarUrl ?? null,
          count: 1,
          topics: [],
          mentions: mentions.length > 0 ? [...mentions] : [...names],
        });
      }
    }

    friendActivity = [...counts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)
      .map(({ mentions, ...friend }) => ({
        ...friend,
        topics: countTop(mentions, 2).map((entry) => entry.name),
      }));
  }

  return { followingCount: following.length, followerCount, friendActivity };
}

export async function getWrappedStats(
  userId: string,
  options: { tzOffsetMinutes?: number } = {},
  db: DbClient = prisma,
): Promise<WrappedStats> {
  const tzShiftMs = clampOffset(options.tzOffsetMinutes ?? 0) * 60_000;
  const nowLocalMs = Date.now() + tzShiftMs;

  const social = await getSocialWrappedStats(userId, db);

  const captures = await db.capturedItem.findMany({
    where: { userId },
    select: {
      kind: true,
      capturedAt: true,
      topics: {
        select: { topic: { select: { name: true } } },
      },
    },
    orderBy: { capturedAt: "asc" },
  });

  if (captures.length === 0) {
    return {
      totalCaptures: 0,
      firstCaptureAt: null,
      daysSinceFirst: 0,
      distinctTopics: 0,
      topFields: [],
      topTopics: [],
      recentNewTopics: [],
      busiestDayOfWeek: null,
      busiestHour: null,
      hourHistogram: new Array<number>(24).fill(0),
      weekdayHistogram: new Array<number>(7).fill(0),
      formats: [],
      currentStreak: 0,
      longestStreak: 0,
      streakHeldDays: 0,
      arcs: buildArcs([], nowLocalMs),
      ...social,
    };
  }

  const localMsList = captures.map((c) => new Date(c.capturedAt).getTime() + tzShiftMs);
  const firstCaptureAt = new Date(captures[0].capturedAt);
  const nowLocal = new Date(nowLocalMs);

  // Topics: split the coarse fields (general) from specific sub-topics so the
  // You page can talk about both "the fields you live in" and "what you're
  // digging into". `recentNewTopics` tracks new SPECIFIC territory (new
  // fields are rare and less interesting to surface).
  const fieldMentions: string[] = [];
  const specificMentions: string[] = [];
  const topicFirstSeen = new Map<string, number>();
  const specificFirstSeen = new Map<string, number>();
  captures.forEach((capture, i) => {
    const at = localMsList[i];
    for (const link of capture.topics) {
      const name = link.topic.name;
      const general = isGeneralTopic(name);
      (general ? fieldMentions : specificMentions).push(name);
      if (!topicFirstSeen.has(name) || at < topicFirstSeen.get(name)!) {
        topicFirstSeen.set(name, at);
      }
      if (!general && (!specificFirstSeen.has(name) || at < specificFirstSeen.get(name)!)) {
        specificFirstSeen.set(name, at);
      }
    }
  });

  // A rolling window ending now, not the calendar month. On a month boundary the
  // old version emptied the card and then refilled it in discovery order — and
  // because the client took the FIRST six, a topic broken into on the 3rd held
  // its slot for the rest of the month while everything discovered since was
  // invisible. Sorting by when each was first seen and keeping the newest means
  // the card is always the last few places you actually went.
  const discoveryCutoff = nowLocalMs - DISCOVERY_WINDOW_DAYS * DAY_MS;
  const recentNewTopics = [...specificFirstSeen.entries()]
    .filter(([, firstAt]) => firstAt >= discoveryCutoff)
    .sort((a, b) => a[1] - b[1])
    .slice(-DISCOVERY_LIMIT)
    .map(([name]) => name);

  const weekdayHistogram = new Array<number>(7).fill(0);
  const hourHistogram = new Array<number>(24).fill(0);
  for (const ms of localMsList) {
    const at = new Date(ms);
    weekdayHistogram[at.getUTCDay()] += 1;
    hourHistogram[at.getUTCHours()] += 1;
  }
  const busiestWeekdayIdx = weekdayHistogram.indexOf(Math.max(...weekdayHistogram));
  const busiestHour = hourHistogram.indexOf(Math.max(...hourHistogram));

  // Freezes already spent on this user's missed days. Read-only here — the
  // sweep in services/streak.ts is the only thing that ever grants one.
  const frozenDays = await loadFrozenDays(userId, db);
  const { current, longest, held } = computeStreaks(
    localMsList.map((ms) => Math.floor(ms / DAY_MS)),
    Math.floor(nowLocalMs / DAY_MS),
    frozenDays,
  );

  return {
    totalCaptures: captures.length,
    firstCaptureAt: firstCaptureAt.toISOString(),
    daysSinceFirst: Math.max(0, Math.floor((Date.now() - firstCaptureAt.getTime()) / DAY_MS)),
    distinctTopics: topicFirstSeen.size,
    topFields: countTop(fieldMentions, 5),
    topTopics: countTop(specificMentions, 6),
    recentNewTopics,
    busiestDayOfWeek: WEEKDAYS[busiestWeekdayIdx] ?? null,
    busiestHour,
    hourHistogram,
    weekdayHistogram,
    formats: countTop(
      // Quotes are folded into text (the quote capture type was retired), so
      // legacy QUOTE captures count toward the "text" format/persona.
      captures.map((c) => (c.kind === "QUOTE" ? "text" : c.kind.toLowerCase())),
      4,
    ),
    currentStreak: current,
    longestStreak: longest,
    streakHeldDays: held,
    arcs: buildArcs(localMsList, nowLocalMs),
    ...social,
  };
}
