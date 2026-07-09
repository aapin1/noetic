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
  /** Specific sub-topics that first appeared this calendar month. */
  newTopicsThisMonth: string[];
  busiestDayOfWeek: string | null;
  busiestHour: number | null;
  /** Captures per hour of day (0–23) and per weekday (index 0 = Sunday). */
  hourHistogram: number[];
  weekdayHistogram: number[];
  formats: { name: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  arcs: WrappedArcs;
  followingCount: number;
  followerCount: number;
  /** The first person this user ever followed. */
  firstFollow: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    followedAt: string;
  } | null;
  /** People this user follows who've captured something in the last 7 days, busiest first. */
  friendActivity: {
    handle: string;
    displayName: string;
    avatarUrl: string | null;
    count: number;
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

function computeStreaks(localDayIndices: number[]): { current: number; longest: number } {
  const dayIndices = [...new Set(localDayIndices)].sort((a, b) => a - b);
  if (dayIndices.length === 0) {
    return { current: 0, longest: 0 };
  }

  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of dayIndices) {
    run = prev !== null && day === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = day;
  }

  // Current streak = consecutive days ending at the most recent active day.
  let current = 0;
  prev = null;
  for (let i = dayIndices.length - 1; i >= 0; i -= 1) {
    const day = dayIndices[i];
    if (prev === null || day === prev - 1) {
      current += 1;
      prev = day;
    } else {
      break;
    }
  }

  return { current, longest };
}

async function getSocialWrappedStats(
  userId: string,
  db: DbClient,
): Promise<Pick<WrappedStats, "followingCount" | "followerCount" | "firstFollow" | "friendActivity">> {
  const profileSelect = { handle: true, displayName: true, avatarUrl: true } as const;

  const following = await db.follow.findMany({
    where: { followerId: userId },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      following: { select: { id: true, profile: { select: profileSelect } } },
    },
  });

  const followerCount = await db.follow.count({ where: { followingId: userId } });

  const first = following[0];
  const firstFollow = first
    ? {
        handle: first.following.profile?.handle ?? first.following.id,
        displayName: first.following.profile?.displayName ?? "Unknown",
        avatarUrl: first.following.profile?.avatarUrl ?? null,
        followedAt: first.createdAt.toISOString(),
      }
    : null;

  let friendActivity: WrappedStats["friendActivity"] = [];
  if (following.length > 0) {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const followingIds = following.map((f) => f.following.id);
    const recentCaptures = await db.capturedItem.findMany({
      where: { userId: { in: followingIds }, capturedAt: { gte: since } },
      select: {
        userId: true,
        user: { select: { profile: { select: profileSelect } } },
      },
    });

    const counts = new Map<string, WrappedStats["friendActivity"][number]>();
    for (const capture of recentCaptures) {
      const existing = counts.get(capture.userId);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(capture.userId, {
          handle: capture.user.profile?.handle ?? capture.userId,
          displayName: capture.user.profile?.displayName ?? "Unknown",
          avatarUrl: capture.user.profile?.avatarUrl ?? null,
          count: 1,
        });
      }
    }
    friendActivity = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  }

  return { followingCount: following.length, followerCount, firstFollow, friendActivity };
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
      newTopicsThisMonth: [],
      busiestDayOfWeek: null,
      busiestHour: null,
      hourHistogram: new Array<number>(24).fill(0),
      weekdayHistogram: new Array<number>(7).fill(0),
      formats: [],
      currentStreak: 0,
      longestStreak: 0,
      arcs: buildArcs([], nowLocalMs),
      ...social,
    };
  }

  const localMsList = captures.map((c) => new Date(c.capturedAt).getTime() + tzShiftMs);
  const firstCaptureAt = new Date(captures[0].capturedAt);
  const nowLocal = new Date(nowLocalMs);

  // Topics: split the coarse fields (general) from specific sub-topics so the
  // You page can talk about both "the fields you live in" and "what you're
  // digging into". `newTopicsThisMonth` tracks new SPECIFIC territory (new
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

  const thisMonth = nowLocal.getUTCFullYear() * 12 + nowLocal.getUTCMonth();
  const newTopicsThisMonth = [...specificFirstSeen.entries()]
    .filter(([, firstAt]) => {
      const at = new Date(firstAt);
      return at.getUTCFullYear() * 12 + at.getUTCMonth() === thisMonth;
    })
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

  const { current, longest } = computeStreaks(localMsList.map((ms) => Math.floor(ms / DAY_MS)));

  return {
    totalCaptures: captures.length,
    firstCaptureAt: firstCaptureAt.toISOString(),
    daysSinceFirst: Math.max(0, Math.floor((Date.now() - firstCaptureAt.getTime()) / DAY_MS)),
    distinctTopics: topicFirstSeen.size,
    topFields: countTop(fieldMentions, 5),
    topTopics: countTop(specificMentions, 6),
    newTopicsThisMonth,
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
    arcs: buildArcs(localMsList, nowLocalMs),
    ...social,
  };
}
