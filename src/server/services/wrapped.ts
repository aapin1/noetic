import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { isGeneralTopic } from "@/server/cognition/generalTopics";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  formats: { name: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  /** Last 6 calendar months (oldest → newest), zero-filled. */
  monthlyArc: { month: string; count: number }[];
  followingCount: number;
  followerCount: number;
  /** The first person this user ever followed. */
  firstFollow: { handle: string; displayName: string; followedAt: string } | null;
  /** People this user follows who've captured something in the last 7 days, busiest first. */
  friendActivity: { handle: string; displayName: string; count: number }[];
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function countTop(pairs: string[], limit: number): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const name of pairs) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function computeStreaks(capturedAts: Date[]): { current: number; longest: number } {
  const dayIndices = [...new Set(capturedAts.map((d) => Math.floor(d.getTime() / DAY_MS)))].sort(
    (a, b) => a - b,
  );
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
  const following = await db.follow.findMany({
    where: { followerId: userId },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      following: { select: { id: true, profile: { select: { handle: true, displayName: true } } } },
    },
  });

  const followerCount = await db.follow.count({ where: { followingId: userId } });

  const first = following[0];
  const firstFollow = first
    ? {
        handle: first.following.profile?.handle ?? first.following.id,
        displayName: first.following.profile?.displayName ?? "Unknown",
        followedAt: first.createdAt.toISOString(),
      }
    : null;

  let friendActivity: { handle: string; displayName: string; count: number }[] = [];
  if (following.length > 0) {
    const since = new Date(Date.now() - 7 * DAY_MS);
    const followingIds = following.map((f) => f.following.id);
    const recentCaptures = await db.capturedItem.findMany({
      where: { userId: { in: followingIds }, capturedAt: { gte: since } },
      select: {
        userId: true,
        user: { select: { profile: { select: { handle: true, displayName: true } } } },
      },
    });

    const counts = new Map<string, { handle: string; displayName: string; count: number }>();
    for (const capture of recentCaptures) {
      const existing = counts.get(capture.userId);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(capture.userId, {
          handle: capture.user.profile?.handle ?? capture.userId,
          displayName: capture.user.profile?.displayName ?? "Unknown",
          count: 1,
        });
      }
    }
    friendActivity = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  }

  return { followingCount: following.length, followerCount, firstFollow, friendActivity };
}

export async function getWrappedStats(userId: string, db: DbClient = prisma): Promise<WrappedStats> {
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

  const empty: WrappedStats = {
    totalCaptures: 0,
    firstCaptureAt: null,
    daysSinceFirst: 0,
    distinctTopics: 0,
    topFields: [],
    topTopics: [],
    newTopicsThisMonth: [],
    busiestDayOfWeek: null,
    busiestHour: null,
    formats: [],
    currentStreak: 0,
    longestStreak: 0,
    monthlyArc: [],
    ...social,
  };

  if (captures.length === 0) {
    return empty;
  }

  const capturedAts = captures.map((c) => new Date(c.capturedAt));
  const firstCaptureAt = capturedAts[0];
  const now = new Date();

  // Topics: split the coarse fields (general) from specific sub-topics so the
  // You page can talk about both "the fields you live in" and "what you're
  // digging into". `newTopicsThisMonth` tracks new SPECIFIC territory (new
  // fields are rare and less interesting to surface).
  const fieldMentions: string[] = [];
  const specificMentions: string[] = [];
  const topicFirstSeen = new Map<string, number>();
  const specificFirstSeen = new Map<string, number>();
  for (const capture of captures) {
    const at = new Date(capture.capturedAt).getTime();
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
  }
  const thisMonthKey = monthKey(now);
  const newTopicsThisMonth = [...specificFirstSeen.entries()]
    .filter(([, firstAt]) => monthKey(new Date(firstAt)) === thisMonthKey)
    .map(([name]) => name);

  // Busiest weekday / hour by mode.
  const weekdayCounts = new Array<number>(7).fill(0);
  const hourCounts = new Array<number>(24).fill(0);
  for (const at of capturedAts) {
    weekdayCounts[at.getUTCDay()] += 1;
    hourCounts[at.getUTCHours()] += 1;
  }
  const busiestWeekdayIdx = weekdayCounts.indexOf(Math.max(...weekdayCounts));
  const busiestHour = hourCounts.indexOf(Math.max(...hourCounts));

  // Last 6 calendar months, zero-filled.
  const monthTotals = new Map<string, number>();
  for (const at of capturedAts) {
    const key = monthKey(at);
    monthTotals.set(key, (monthTotals.get(key) ?? 0) + 1);
  }
  const monthlyArc: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    monthlyArc.push({ month: key, count: monthTotals.get(key) ?? 0 });
  }

  const { current, longest } = computeStreaks(capturedAts);

  return {
    totalCaptures: captures.length,
    firstCaptureAt: firstCaptureAt.toISOString(),
    daysSinceFirst: Math.max(0, Math.floor((now.getTime() - firstCaptureAt.getTime()) / DAY_MS)),
    distinctTopics: topicFirstSeen.size,
    topFields: countTop(fieldMentions, 5),
    topTopics: countTop(specificMentions, 5),
    newTopicsThisMonth,
    busiestDayOfWeek: WEEKDAYS[busiestWeekdayIdx] ?? null,
    busiestHour,
    formats: countTop(
      // Quotes are folded into text (the quote capture type was retired), so
      // legacy QUOTE captures count toward the "text" format/persona.
      captures.map((c) => (c.kind === "QUOTE" ? "text" : c.kind.toLowerCase())),
      4,
    ),
    currentStreak: current,
    longestStreak: longest,
    monthlyArc,
    ...social,
  };
}
