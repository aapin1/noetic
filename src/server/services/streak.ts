import { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { dueThisHourWhere } from "@/server/services/notification-policy";
import { createNotification } from "@/server/services/notifications";
import { computeStreaks } from "@/server/services/wrapped";

/**
 * Streak protection.
 *
 * Every user carries one automatic freeze per week. When a day is missed it is
 * spent silently, and the user is told afterwards — warmly, once, and only
 * about something that has already happened.
 *
 * The thing this file most carefully does NOT do is warn anyone. There is no
 * "your streak is at risk", no countdown, no evening nudge. A warning turns a
 * quiet record of attention into a debt the app collects on, which is the
 * opposite of the intent: this should read as the app being generous, not as a
 * game mechanic. `planStreakFreeze` returns null in every at-risk case, and
 * `STREAK_HELD` is the only notification type this module can emit.
 */

const DAY_MS = 86_400_000;

/** One freeze per week, measured from the day the last one was spent. */
export const FREEZE_REFILL_DAYS = 7;

/**
 * A run this short isn't worth the week's freeze.
 *
 * Freezes are scarce by design, and spending one to protect a two-day streak —
 * then pushing "we held your streak for you" about it — reads as pleading
 * rather than generous. Weeks of investment are what this exists to defend.
 */
export const MIN_STREAK_TO_PROTECT = 3;

/**
 * How much capture history the guard loads. Bounds the per-user read on a
 * sweep; a streak longer than this reports as this, which is a number no user
 * has yet come close to.
 */
const HISTORY_WINDOW_DAYS = 400;

/**
 * Frozen days are pruned on exactly the same horizon as the capture history.
 *
 * These two MUST agree. Pruning sooner would drop a freeze that is still
 * bridging a live run — the run would split at that day and the streak would
 * drop by weeks for no reason the user could see, which is the precise failure
 * this feature exists to prevent. Beyond the window there is no capture history
 * left for a freeze to bridge, so it can go. At one per week this holds ~57
 * entries at the very most.
 */
const FROZEN_DAY_RETENTION = HISTORY_WINDOW_DAYS;

/**
 * Only users who captured this recently can have a live streak worth saving —
 * anything older is already broken and a freeze cannot revive it. This is what
 * keeps the sweep cheap: it is a far smaller set than the resurfacing sweep,
 * and covers yesterday plus the widest possible timezone skew.
 */
const SWEEP_ACTIVE_WITHIN_DAYS = 3;

/** JS convention: UTC-4 reports -240. Beyond ±14h is not a real offset. */
function clampOffset(minutes: number | null | undefined): number {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(minutes)));
}

/** Local epoch-day index for an instant, under a given offset. */
export function localDayIndex(at: Date, tzOffsetMinutes: number): number {
  return Math.floor((at.getTime() + clampOffset(tzOffsetMinutes) * 60_000) / DAY_MS);
}

export type FreezePlan = {
  /** The local day the freeze covers — always yesterday. */
  day: number;
  /** Length of the run being saved, in real capture days. */
  streak: number;
};

/**
 * Decide whether to spend a freeze, from history alone. Pure, so the awkward
 * cases (a one-day gap, a two-day gap, a return after a week) are testable
 * without a database.
 *
 * Returns null far more often than not. Every guard below is a case where
 * spending the freeze would be wrong rather than merely unnecessary.
 */
export function planStreakFreeze(args: {
  /** Local day indices on which the user captured something. */
  captureDays: number[];
  /** Local days already covered by an earlier freeze. */
  frozenDays: number[];
  todayIdx: number;
  /** Local day the last freeze was spent, or null if never. */
  lastFreezeDay: number | null;
}): FreezePlan | null {
  const { todayIdx, lastFreezeDay } = args;
  const yesterday = todayIdx - 1;

  const covered = new Set<number>([...args.captureDays, ...args.frozenDays]);

  // Nothing was missed. This is the at-risk case — the user has captured
  // through yesterday and simply hasn't captured *today* yet. Today is not
  // over, nothing is wrong, and there is nothing to tell them. Warning here is
  // exactly the behaviour this feature refuses to have.
  if (covered.has(yesterday)) return null;

  // The run was already broken before yesterday, so there is nothing live for a
  // freeze to hold. Returning after eight days lands here and spends nothing.
  if (!covered.has(yesterday - 1)) return null;

  // Refill: measured between the days a freeze COVERS, not between the sweeps
  // that granted them. Comparing against today instead would let two protected
  // days sit six apart — the sweep runs the morning after the day it covers, so
  // that one day of lag silently shortens the week.
  //
  // A second consecutive missed day lands here and is not covered: the freeze
  // is weekly, so the streak breaks. That is the intended ceiling.
  if (lastFreezeDay !== null && yesterday - lastFreezeDay < FREEZE_REFILL_DAYS) return null;

  // Measure the run ending the day before yesterday, counting only real capture
  // days so an earlier freeze can bridge but never pad it.
  const captureDays = new Set(args.captureDays);
  let streak = 0;
  for (let day = yesterday - 1; covered.has(day); day -= 1) {
    if (captureDays.has(day)) streak += 1;
  }

  if (streak < MIN_STREAK_TO_PROTECT) return null;

  return { day: yesterday, streak };
}

/**
 * Copy for a freeze that has already been spent.
 *
 * Two constraints pull against each other here, and both matter.
 *
 * It must not warn: no risk, no deadline, no countdown. The freeze has already
 * happened and the user is being told about it, not asked to act under threat.
 *
 * But it must also not *declare a completed save*. "we kept your 12 days for
 * you" is a claim about a finished outcome, and it stops being true the moment
 * a second day is missed — the freeze is weekly, the streak breaks, and the
 * user opens the app to a 1 with our congratulations still on their lock
 * screen. What is actually true is narrower and stays true either way: the run
 * is intact right now, yesterday is bridged, and today is what settles it.
 *
 * So: present tense about a live condition, and an invitation rather than an
 * ultimatum. "capture today and the run holds" is the same sentence a warning
 * would use, minus the threat — which is the honest amount of information.
 */
function freezeCopy(streak: number): { title: string; body: string } {
  return {
    title: `your ${streak} days are still alive`,
    body: "you missed yesterday — we bridged it. capture today and the run holds.",
  };
}

async function loadCaptureDays(args: {
  userId: string;
  db: DbClient;
  now: Date;
  tzOffsetMinutes: number;
}): Promise<number[]> {
  const rows = await args.db.capturedItem.findMany({
    where: {
      userId: args.userId,
      capturedAt: { gte: new Date(args.now.getTime() - HISTORY_WINDOW_DAYS * DAY_MS) },
    },
    // Only the instant. Never `include` here — this runs per user on a sweep,
    // and the row carries embeddings and full article bodies.
    select: { capturedAt: true },
  });

  return [...new Set(rows.map((row) => localDayIndex(row.capturedAt, args.tzOffsetMinutes)))];
}

/**
 * Record the client's clock.
 *
 * The day index of a capture is what defines a streak day, so the offset has to
 * be known wherever that unit is created or read. Called from the capture path
 * above all — a user who never opens the You page would otherwise sit at UTC
 * forever, and for a US user that is enough to push a late-night capture into
 * the wrong day and break a streak the freeze then spends itself on.
 *
 * Fire-and-forget: never blocks a capture, never throws into one.
 */
export async function rememberTzOffset(
  userId: string,
  tzOffsetMinutes: number | null | undefined,
  db: DbClient = prisma,
): Promise<void> {
  if (tzOffsetMinutes === null || tzOffsetMinutes === undefined) return;
  if (!Number.isFinite(tzOffsetMinutes)) return;
  const offset = clampOffset(tzOffsetMinutes);

  try {
    // A dedicated column, not a key inside `preferences` — that column is
    // written wholesale by updatePreferences, and a read-modify-write here
    // would race the sweep and silently drop one side's work.
    await db.userPreference.upsert({
      where: { userId },
      update: { tzOffsetMinutes: offset },
      create: { userId, tzOffsetMinutes: offset },
    });
  } catch {
    // The offset is a refinement, not a requirement. Losing one write costs a
    // few hours of precision until the next capture, and costs the caller
    // nothing at all.
  }
}

/**
 * Credit today as streak activity because the user reviewed (/today), not
 * captured. Same day-bucket unit as a capture day and counted identically by
 * computeStreaks — unlike a frozen day, which only bridges. Idempotent per
 * local day: the day index is set-unioned into its own scalar column, pruned
 * on the same horizon as the freeze history.
 */
export async function recordReviewActivity(args: {
  userId: string;
  tzOffsetMinutes?: number;
  db?: DbClient;
  now?: Date;
}): Promise<{ credited: boolean; dayIndex: number }> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const today = localDayIndex(now, clampOffset(args.tzOffsetMinutes));

  // Fail closed, like the freeze code: if the row can't be read, do not write —
  // an upsert on top of an unread row would overwrite the array and erase
  // previously credited days. Skipping the credit costs one day at worst.
  let prefs: { streakActivityDays: number[] } | null;
  try {
    prefs = await db.userPreference.findUnique({
      where: { userId: args.userId },
      select: { streakActivityDays: true },
    });
  } catch {
    return { credited: false, dayIndex: today };
  }
  const days = prefs?.streakActivityDays ?? [];
  if (days.includes(today)) {
    return { credited: false, dayIndex: today };
  }

  const kept = [...new Set([...days.filter((day) => day > today - FROZEN_DAY_RETENTION), today])];
  await db.userPreference.upsert({
    where: { userId: args.userId },
    update: { streakActivityDays: kept },
    create: { userId: args.userId, streakActivityDays: [today] },
  });
  return { credited: true, dayIndex: today };
}

export type StreakSummary = {
  current: number;
  longest: number;
  /** Days inside the live run a freeze covered. Post-hoc information only. */
  heldDays: number;
};

/**
 * The streak as the home screen shows it. Deliberately small: one indexed range
 * read and the shared computation, so it can ride along with every app open.
 */
export async function getStreakSummary(args: {
  userId: string;
  tzOffsetMinutes?: number;
  db?: DbClient;
  now?: Date;
}): Promise<StreakSummary> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const offset = clampOffset(args.tzOffsetMinutes);

  const [captureDays, prefs] = await Promise.all([
    loadCaptureDays({ userId: args.userId, db, now, tzOffsetMinutes: offset }),
    db.userPreference
      .findUnique({
        where: { userId: args.userId },
        select: { streakFrozenDays: true, streakActivityDays: true },
      })
      .catch(() => null),
  ]);

  // Review-activity days (/today visits) count exactly like capture days.
  const activeDays = [...new Set([...captureDays, ...(prefs?.streakActivityDays ?? [])])];

  const { current, longest, held } = computeStreaks(
    activeDays,
    localDayIndex(now, offset),
    prefs?.streakFrozenDays ?? [],
  );

  return { current, longest, heldDays: held };
}

export type StreakHeld = {
  userId: string;
  /** Local day the freeze covered. */
  day: number;
  /** The run it saved, in real capture days. */
  streak: number;
};

/**
 * Apply the guard for one user: spend a freeze if a missed day would otherwise
 * end a run worth protecting, and queue the notification that says so.
 *
 * Returns null when nothing was held — the common case by a wide margin.
 */
export async function applyStreakGuard(args: {
  userId: string;
  db?: DbClient;
  now?: Date;
}): Promise<StreakHeld | null> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();

  const prefs = await db.userPreference.findUnique({
    where: { userId: args.userId },
    select: { tzOffsetMinutes: true, streakFrozenDays: true, streakLastFreezeDay: true },
  });

  const offset = clampOffset(prefs?.tzOffsetMinutes);
  const todayIdx = localDayIndex(now, offset);
  const frozenDays = prefs?.streakFrozenDays ?? [];

  const captureDays = await loadCaptureDays({
    userId: args.userId,
    db,
    now,
    tzOffsetMinutes: offset,
  });

  const plan = planStreakFreeze({
    captureDays,
    frozenDays,
    todayIdx,
    lastFreezeDay: prefs?.streakLastFreezeDay ?? null,
  });
  if (!plan) return null;

  // Persist the freeze before announcing it. If the notification write fails
  // the streak is still held, which is the part that matters; the reverse would
  // tell someone we saved a streak we then let break.
  const kept = [...new Set([...frozenDays, plan.day])]
    .filter((day) => day > todayIdx - FROZEN_DAY_RETENTION)
    .sort((a, b) => a - b);

  await db.userPreference.upsert({
    where: { userId: args.userId },
    update: { streakFrozenDays: kept, streakLastFreezeDay: plan.day },
    create: {
      userId: args.userId,
      tzOffsetMinutes: offset,
      streakFrozenDays: kept,
      streakLastFreezeDay: plan.day,
    },
  });

  // The freeze counts the day it bridged, so the run the user now has is the
  // one it saved plus that day's worth of continuity.
  const copy = freezeCopy(plan.streak);
  await createNotification({
    db,
    recipientId: args.userId,
    type: NotificationType.STREAK_HELD,
    title: copy.title,
    body: copy.body,
    // Home — where the streak is now visible, and where the act that keeps it
    // going already lives. resolveDeepLink treats this as the default route.
    deepLink: "/(tabs)",
    payload: { streakFreeze: true, frozenDay: plan.day, streak: plan.streak },
  });

  return { userId: args.userId, day: plan.day, streak: plan.streak };
}

export type StreakGuardSweepResult = {
  considered: number;
  held: number;
  /**
   * Who was held. The hourly job hands this to the resurfacing sweep, which
   * skips them: streak beats resurfacing, and the loser must not be selected —
   * selecting it would write the notification and mark its key seen even though
   * it never goes out.
   */
  heldUserIds: string[];
};

/**
 * Run the guard across everyone whose streak could still be alive, and for whom
 * it is currently the send hour locally.
 *
 * Note the two things this is NOT scoped to, both for the same reason.
 *
 * Not a live push token: a freeze is a property of the account, not of its
 * reachability. Gating it on notifications would mean users who declined
 * permission quietly lose streaks that users who accepted keep. They simply
 * don't get told — dispatch marks the notification FAILED for want of a device
 * and the streak survives regardless.
 *
 * Not the `pushStreak` preference either, and that is the same argument one
 * step further in: muting a notification is a statement about notifications,
 * not a request to stop protecting the streak. `dueThisHourWhere` is therefore
 * called WITHOUT a category here, unlike in the resurfacing sweep. The
 * preference is honoured at the send gate, where it belongs.
 */
export async function runStreakGuardSweep(args: {
  db?: DbClient;
  now?: Date;
  limit?: number;
  /** Pre-resolved candidates. The hourly job resolves both sweeps' user sets in
   * one read and passes them in; without it each sweep would repeat nearly the
   * same query. Omit to have the sweep find its own. */
  userIds?: string[];
} = {}): Promise<StreakGuardSweepResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const activeSince = new Date(now.getTime() - SWEEP_ACTIVE_WITHIN_DAYS * DAY_MS);

  const users = args.userIds
    ? args.userIds.map((id) => ({ id }))
    : await db.user.findMany({
        where: {
          capturedItems: { some: { capturedAt: { gte: activeSince } } },
          ...dueThisHourWhere(now),
        },
        select: { id: true },
        ...(args.limit ? { take: args.limit } : {}),
      });

  const heldUserIds: string[] = [];
  for (const user of users) {
    try {
      const result = await applyStreakGuard({ userId: user.id, db, now });
      if (result) heldUserIds.push(user.id);
    } catch (error) {
      // One user's bad data must never stop the sweep for everyone else.
      console.error("[streak] guard failed", user.id, error);
    }
  }

  return { considered: users.length, held: heldUserIds.length, heldUserIds };
}
