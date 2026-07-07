import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface WrappedStats {
  totalCaptures: number;
  firstCaptureAt: string | null;
  daysSinceFirst: number;
  distinctTopics: number;
  topTopics: { name: string; count: number }[];
  newTopicsThisMonth: string[];
  busiestDayOfWeek: string | null;
  busiestHour: number | null;
  formats: { name: string; count: number }[];
  currentStreak: number;
  longestStreak: number;
  /** Last 6 calendar months (oldest → newest), zero-filled. */
  monthlyArc: { month: string; count: number }[];
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

export async function getWrappedStats(userId: string, db: DbClient = prisma): Promise<WrappedStats> {
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
    topTopics: [],
    newTopicsThisMonth: [],
    busiestDayOfWeek: null,
    busiestHour: null,
    formats: [],
    currentStreak: 0,
    longestStreak: 0,
    monthlyArc: [],
  };

  if (captures.length === 0) {
    return empty;
  }

  const capturedAts = captures.map((c) => new Date(c.capturedAt));
  const firstCaptureAt = capturedAts[0];
  const now = new Date();

  // Topics: totals, top list, and which topics first showed up this month.
  const topicMentions: string[] = [];
  const topicFirstSeen = new Map<string, number>();
  for (const capture of captures) {
    const at = new Date(capture.capturedAt).getTime();
    for (const link of capture.topics) {
      const name = link.topic.name;
      topicMentions.push(name);
      if (!topicFirstSeen.has(name) || at < topicFirstSeen.get(name)!) {
        topicFirstSeen.set(name, at);
      }
    }
  }
  const thisMonthKey = monthKey(now);
  const newTopicsThisMonth = [...topicFirstSeen.entries()]
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
    topTopics: countTop(topicMentions, 5),
    newTopicsThisMonth,
    busiestDayOfWeek: WEEKDAYS[busiestWeekdayIdx] ?? null,
    busiestHour,
    formats: countTop(
      captures.map((c) => c.kind.toLowerCase()),
      4,
    ),
    currentStreak: current,
    longestStreak: longest,
    monthlyArc,
  };
}
