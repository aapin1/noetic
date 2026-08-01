import { NotificationType, type Prisma } from "@prisma/client";

/**
 * Who is allowed to receive which push, and when.
 *
 * Everything here is pure. The rules are the part most worth being certain
 * about — a quiet-hours bug wakes people at 4am and there is no undo — so they
 * are decided by functions that take numbers and return booleans, and the
 * database work stays in the callers.
 *
 * Four independent gates, and a push must clear all of them:
 *
 *   1. the kill switch      — global, env-gated, on by default
 *   2. the category         — this user asked not to hear about this kind
 *   3. quiet hours          — per-user, in THEIR local time, holds rather than drops
 *   4. the daily ceiling    — no more than N pushes a day, whatever they are
 *
 * Arbitration (which push wins when two qualify at once) is a fifth question,
 * answered by CATEGORY_PRIORITY at the bottom of this file.
 */

/** Minutes in a day, and the day in ms — shared by the hour math below. */
const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

/**
 * The three kinds of push Mneme sends, from the user's point of view.
 *
 * Deliberately coarser than NotificationType: nobody wants to opt out of
 * "DORMANT_REVIVAL" specifically, and offering that choice would only make the
 * settings screen an inventory of our implementation.
 */
export type PushCategory = "social" | "resurface" | "streak";

const CATEGORY_BY_TYPE: Record<NotificationType, PushCategory> = {
  [NotificationType.NEW_FOLLOW]: "social",
  [NotificationType.NEW_LIKE]: "social",
  [NotificationType.NEW_COMMENT]: "social",
  [NotificationType.NEW_REPLY]: "social",
  [NotificationType.RANKING_UPDATED]: "social",
  [NotificationType.CONTRADICTION_FOUND]: "resurface",
  [NotificationType.THREAD_MOMENTUM]: "resurface",
  [NotificationType.DORMANT_REVIVAL]: "resurface",
  [NotificationType.RESURFACE]: "resurface",
  [NotificationType.STREAK_HELD]: "streak",
};

/**
 * Which category a notification type belongs to.
 *
 * The record above is exhaustive over the enum rather than a switch with a
 * default, so adding a NotificationType fails the typecheck here instead of
 * quietly inheriting somebody else's opt-out. That is the specific way
 * STREAK_HELD would otherwise have been missed: it is neither social nor
 * resurfacing, and every gate in this file is keyed on category.
 */
export function categoryOf(type: NotificationType): PushCategory {
  return CATEGORY_BY_TYPE[type];
}

/**
 * The global kill switch.
 *
 * Defaults to ON: an unset variable must never mean "silence", or a fresh
 * environment would look healthy while delivering nothing. Only the explicit
 * strings below disable it, so a typo fails loud (pushes keep flowing) rather
 * than silent.
 *
 * This exists so that bad copy or a misfiring cron is a dashboard toggle and a
 * restart, not a deploy. Read per call, never cached — the whole point is that
 * flipping it takes effect on the next run.
 */
export function pushDeliveryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = env.PUSH_NOTIFICATIONS_ENABLED;
  if (raw === undefined || raw === null || raw.trim() === "") return true;
  const value = raw.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off" || value === "no");
}

/** JS convention: UTC-4 reports -240. Beyond ±14h is not a real offset. */
export function clampOffset(minutes: number | null | undefined): number {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(minutes)));
}

/** Local hour (0–23) for an instant, under a given offset. */
export function localHour(at: Date, tzOffsetMinutes: number): number {
  const shifted = at.getTime() + clampOffset(tzOffsetMinutes) * MS_PER_MINUTE;
  const minuteOfDay = ((Math.floor(shifted / MS_PER_MINUTE) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return Math.floor(minuteOfDay / 60);
}

/** An hour outside 0–23 is corrupt input; fall back rather than trust it. */
function safeHour(hour: number | null | undefined, fallback: number): number {
  if (hour === null || hour === undefined || !Number.isFinite(hour)) return fallback;
  const rounded = Math.trunc(hour);
  return rounded >= 0 && rounded <= 23 ? rounded : fallback;
}

export const DEFAULT_QUIET_START_HOUR = 21;
export const DEFAULT_QUIET_END_HOUR = 9;

/**
 * Is this local hour inside the user's quiet window?
 *
 * The window is [start, end) and wraps midnight when start > end, which is the
 * ordinary case (21:00 → 09:00). start === end means the window is empty, not
 * that it covers the whole day: a user who sets both to the same hour is
 * turning quiet hours off, and reading it the other way would silence them
 * permanently with no visible cause.
 */
export function isQuietHour(hour: number, startHour: number, endHour: number): boolean {
  const start = safeHour(startHour, DEFAULT_QUIET_START_HOUR);
  const end = safeHour(endHour, DEFAULT_QUIET_END_HOUR);
  if (start === end) return false;
  return start < end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

/**
 * The most pushes one user can receive in a rolling day, across every category.
 *
 * Three, because the engines are already self-limiting — resurfacing caps
 * itself at one a day and a freeze at one a week — so this ceiling only ever
 * binds on social bursts (a review that gets twenty likes in an evening). It is
 * the backstop that makes "how noisy can Mneme possibly be?" have an answer.
 */
export const MAX_PUSHES_PER_DAY = 3;
export const CEILING_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long a notification may sit PENDING before it is written off.
 *
 * Quiet hours and the ceiling both HOLD rather than drop, which is right — a
 * push that comes due at 2am should arrive at 9am, not vanish. But an
 * unqualified hold is a leak: a user at the ceiling every day would accumulate
 * a queue that eventually delivers a fortnight of stale observations at once.
 *
 * 36 hours clears one full quiet window plus a day at the ceiling, and expires
 * anything that has genuinely stopped being worth saying. "two things you saved
 * disagree" is still true next week; "we held your streak yesterday" is not.
 */
export const PENDING_TTL_MS = 36 * 60 * 60 * 1000;

/** One user's push policy, as the send path needs it. */
export type UserPushPolicy = {
  tzOffsetMinutes: number;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
  pushSocial: boolean;
  pushResurface: boolean;
  pushStreak: boolean;
};

/**
 * Policy for a user we have no preferences row for.
 *
 * Every category on, standard quiet hours. A missing row means "hasn't touched
 * the settings", not "opted out of everything" — the latter would mean the
 * pipeline silently ignored every user who never opened settings, which is
 * most of them.
 */
export const DEFAULT_PUSH_POLICY: UserPushPolicy = {
  tzOffsetMinutes: 0,
  quietHoursStartHour: DEFAULT_QUIET_START_HOUR,
  quietHoursEndHour: DEFAULT_QUIET_END_HOUR,
  pushSocial: true,
  pushResurface: true,
  pushStreak: true,
};

/**
 * Normalise a preferences row (or its absence) into a policy.
 *
 * Takes nullables because that is the shape Prisma hands back — `tzOffsetMinutes`
 * is null until a client has reported one, and the columns added later are null
 * on rows written before them.
 */
type PushPolicyRow = { [K in keyof UserPushPolicy]?: UserPushPolicy[K] | null };

export function toPushPolicy(row: PushPolicyRow | null | undefined): UserPushPolicy {
  if (!row) return DEFAULT_PUSH_POLICY;
  return {
    tzOffsetMinutes: clampOffset(row.tzOffsetMinutes),
    quietHoursStartHour: safeHour(row.quietHoursStartHour, DEFAULT_QUIET_START_HOUR),
    quietHoursEndHour: safeHour(row.quietHoursEndHour, DEFAULT_QUIET_END_HOUR),
    pushSocial: row.pushSocial ?? true,
    pushResurface: row.pushResurface ?? true,
    pushStreak: row.pushStreak ?? true,
  };
}

/** Whether this user wants this category at all. */
export function allowsCategory(policy: UserPushPolicy, category: PushCategory): boolean {
  if (category === "social") return policy.pushSocial;
  if (category === "resurface") return policy.pushResurface;
  return policy.pushStreak;
}

/**
 * What the send path should do with one pending notification right now.
 *
 *  - "send"   — clear on every gate.
 *  - "hold"   — not now, but still worth sending later. Stays PENDING.
 *  - "drop"   — will never be worth sending. Moves to a terminal status.
 *
 * The distinction between hold and drop is the whole design. Holding something
 * the user has opted out of would queue it forever; dropping something that is
 * merely out-of-hours would lose it. Both are silent failures, which is why
 * they are named rather than left to a boolean.
 */
export type SendDecision = "send" | "hold" | "drop";

export function decideSend(args: {
  type: NotificationType;
  createdAt: Date;
  policy: UserPushPolicy;
  /** Pushes already SENT to this user inside the ceiling window. */
  sentInWindow: number;
  now: Date;
}): SendDecision {
  // Stale beats everything: there is no point asking whether a two-day-old
  // "capture today" is in quiet hours.
  if (args.now.getTime() - args.createdAt.getTime() > PENDING_TTL_MS) return "drop";

  // An opt-out is a standing answer, not a timing problem.
  if (!allowsCategory(args.policy, categoryOf(args.type))) return "drop";

  if (isQuietHour(
    localHour(args.now, args.policy.tzOffsetMinutes),
    args.policy.quietHoursStartHour,
    args.policy.quietHoursEndHour,
  )) return "hold";

  if (args.sentInWindow >= MAX_PUSHES_PER_DAY) return "hold";

  return "send";
}

/**
 * Arbitration: which push wins when a user qualifies for more than one.
 *
 * Lower sorts first. Streak beats resurfacing because a streak notification is
 * perishable — "your 12 days are still alive, capture today" is only true
 * today, and tomorrow it is either irrelevant or false. A contradiction between
 * two things you saved is exactly as interesting tomorrow as it is now, so it
 * is the one that can afford to wait.
 *
 * Social sits last: it is the only category the user did not have to be doing
 * anything to trigger, and it is the one that arrives in bursts.
 */
export const CATEGORY_PRIORITY: Record<PushCategory, number> = {
  streak: 0,
  resurface: 1,
  social: 2,
};

/** Most-perishable first. Used to order a user's queue within one drain. */
export function byPriority(a: NotificationType, b: NotificationType): number {
  return CATEGORY_PRIORITY[categoryOf(a)] - CATEGORY_PRIORITY[categoryOf(b)];
}

/* ─────────────────────────── who is due this hour ───────────────────────────
 *
 * The cron is hourly and the sweeps are daily-per-user. What reconciles the two
 * is this: each run selects only the users for whom it is currently
 * DAILY_SEND_HOUR *locally*. Over 24 runs everyone is swept exactly once, each
 * at a civilised hour in their own timezone, and no run does more than about a
 * twenty-fourth of the work.
 *
 * The alternative — one nightly UTC run — cannot do this. It either ignores
 * local time (and wakes Sydney at 3am) or it picks one timezone and serves it
 * (and wakes nobody else at a sensible hour). There is no single instant that
 * is morning everywhere.
 */

/** The local hour the daily sweeps aim for. Morning, and after quiet hours end. */
export const DAILY_SEND_HOUR = 9;

/**
 * Every UTC offset a real client can report, in minutes.
 *
 * Enumerated rather than expressed as a range because the range wraps midnight
 * and the modular arithmetic to express "these offsets are currently at 09:00"
 * as a SQL predicate is the kind of thing that is off by one for two hours a
 * day and nobody notices for a month. There are only ~105 valid offsets — every
 * quarter hour from UTC-12 to UTC+14 — so we can just ask which ones match.
 */
export const VALID_OFFSETS: number[] = Array.from(
  { length: (840 + 720) / 15 + 1 },
  (_, i) => -720 + i * 15,
);

/** The offsets for which it is currently `hour` o'clock locally. */
export function offsetsAtLocalHour(at: Date, hour: number): number[] {
  return VALID_OFFSETS.filter((offset) => localHour(at, offset) === hour);
}

const CATEGORY_COLUMN = {
  social: "pushSocial",
  resurface: "pushResurface",
  streak: "pushStreak",
} as const satisfies Record<PushCategory, string>;

/**
 * A `User` predicate matching everyone due for a daily sweep right now.
 *
 * `category` is optional, and the asymmetry is deliberate. Pass it for work
 * whose only purpose is to send a push — selecting a resurfacing candidate for
 * someone who has switched them off wastes a query and, worse, burns the
 * candidate's dedupe key on a notification they will never see. Omit it for
 * work that has value regardless of whether a push results: the streak guard's
 * freeze is a property of the account, and gating it on a push preference would
 * mean users who muted the notification quietly lose streaks that users who
 * kept it keep.
 *
 * Two things it never excludes:
 *
 *  - a preferences row with a null offset. Null means "no client has told us a
 *    clock", which the policy reads as UTC — so those users are due when UTC is
 *    at the send hour, not never.
 *  - a user with no preferences row at all. `rememberTzOffset` creates one on
 *    the next capture, but an account that predates it would otherwise be
 *    permanently invisible to both sweeps, which is a silent and total failure
 *    for exactly the oldest users.
 */
export function dueThisHourWhere(now: Date, category?: PushCategory): Prisma.UserWhereInput {
  const offsets = offsetsAtLocalHour(now, DAILY_SEND_HOUR);
  const wantsCategory: Prisma.UserPreferenceWhereInput = category
    ? ({ [CATEGORY_COLUMN[category]]: true } as Prisma.UserPreferenceWhereInput)
    : {};

  const branches: Prisma.UserWhereInput[] = [
    { preference: { is: { ...wantsCategory, tzOffsetMinutes: { in: offsets } } } },
  ];

  if (offsets.includes(0)) {
    branches.push({ preference: { is: { ...wantsCategory, tzOffsetMinutes: null } } });
    branches.push({ preference: { is: null } });
  }

  return { OR: branches };
}
