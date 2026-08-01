import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import { withLease } from "@/server/services/jobs";
import { dispatchPendingNotifications, type DispatchResult } from "@/server/services/notifications";
import { dueThisHourWhere } from "@/server/services/notification-policy";
import { runResurfaceSweep } from "@/server/services/resurface";
import { runStreakGuardSweep } from "@/server/services/streak";

/**
 * The hourly notification job: hold the streaks a missed day would end, pick one
 * thing worth saying to each user due this hour, then push what is pending.
 *
 * Why hourly rather than nightly. Quiet hours are enforced per user in their own
 * local time, and there is no single instant that is morning everywhere — a
 * nightly UTC run must either ignore local time or serve one timezone. So the
 * clock ticks every hour and this decides who is due: each user is swept when it
 * is DAILY_SEND_HOUR where they live. Over 24 runs everyone is covered once, and
 * each run does about a twenty-fourth of the work.
 *
 * The cron that calls this holds no logic at all. It is a clock. Everything that
 * decides who, what and whether lives here, where it can be tested.
 *
 * Cost of an hour with nothing to do: two single-row lease writes and two
 * indexed reads, and no outbound request. The sweeps do not query at all when
 * nobody is due, because their candidate sets come from the one read below.
 */

/** The lease name. One job, one lease, forever. */
export const NOTIFICATION_JOB_LEASE = "notifications:hourly";

/** Ceiling per run, so one drain can't run unbounded on a small instance. */
const DISPATCH_LIMIT = 500;

/**
 * How recently a user must have captured for the streak guard to consider them.
 *
 * Mirrors services/streak.ts: only a run that reaches yesterday can be saved,
 * and this covers yesterday plus the widest timezone skew.
 */
const STREAK_ACTIVE_DAYS = 3;
/** Resurfacing looks much further back — a dormant thread is the whole point. */
const RESURFACE_ACTIVE_DAYS = 90;
const DAY_MS = 86_400_000;

export type NotificationJobResult = {
  /** False when another run held the lease and this one stood down. */
  ran: boolean;
  /** Users for whom it is currently the send hour locally. */
  due: number;
  streak: { considered: number; held: number };
  resurface: { considered: number; queued: number };
  dispatch: DispatchResult;
};

const SKIPPED: NotificationJobResult = {
  ran: false,
  due: 0,
  streak: { considered: 0, held: 0 },
  resurface: { considered: 0, queued: 0 },
  dispatch: {
    considered: 0, sent: 0, failed: 0, held: 0, deactivatedTokens: 0, suppressed: false,
  },
};

/**
 * Everyone due this hour, with just enough about each to decide which sweeps
 * apply — resolved in one read rather than one per sweep.
 */
async function resolveDueUsers(db: DbClient, now: Date) {
  return db.user.findMany({
    where: {
      ...dueThisHourWhere(now),
      capturedItems: { some: { capturedAt: { gte: new Date(now.getTime() - RESURFACE_ACTIVE_DAYS * DAY_MS) } } },
    },
    select: {
      id: true,
      // Only the flag the resurfacing sweep gates on. The streak guard reads no
      // preference here on purpose — see runStreakGuardSweep.
      preference: { select: { pushResurface: true } },
      // Existence checks, not lists: `take: 1` keeps this a cheap probe even for
      // a user with thousands of captures and several devices.
      deviceTokens: {
        where: { isActive: true, provider: "EXPO" },
        select: { id: true },
        take: 1,
      },
      capturedItems: {
        orderBy: { capturedAt: "desc" },
        select: { capturedAt: true },
        take: 1,
      },
    },
  });
}

/**
 * Run one tick.
 *
 * Never throws. A run that dies must cost exactly one hour — the next tick is
 * already scheduled, and every step here is idempotent, so there is nothing for
 * a retry to recover that waiting would not. Retrying inside the hour is how a
 * transient Expo outage turns into a thundering herd against it.
 */
export async function runNotificationJob(args: {
  db?: DbClient;
  now?: Date;
} = {}): Promise<NotificationJobResult> {
  const db = args.db ?? prisma;
  const now = args.now ?? new Date();
  const startedAt = Date.now();

  let failure: string | null = null;

  // The lease is what makes overlapping runs safe. Everything below is
  // independently idempotent — the resurfacing cap, the weekly freeze, and the
  // conditional `status: PENDING` updates all no-op on a second pass — but
  // idempotency cannot un-send a message already in flight, and two concurrent
  // drains reading the same PENDING rows would each send them once.
  const outcome = await withLease(NOTIFICATION_JOB_LEASE, async () => {
    const dueUsers = await resolveDueUsers(db, now);
    const streakCutoff = new Date(now.getTime() - STREAK_ACTIVE_DAYS * DAY_MS);

    const streakCandidates = dueUsers
      .filter((user) => {
        const last = user.capturedItems[0]?.capturedAt;
        return last !== undefined && last >= streakCutoff;
      })
      .map((user) => user.id);

    const resurfaceCandidates = dueUsers
      .filter((user) => user.deviceTokens.length > 0)
      // A missing preferences row means "hasn't touched settings", which is a
      // yes. Only an explicit false opts out.
      .filter((user) => user.preference?.pushResurface !== false)
      .map((user) => user.id);

    // Order is the arbitration. The streak guard runs first and reports who it
    // held; the resurfacing sweep skips exactly those users, so a losing
    // candidate is never selected and therefore never marked seen. It is still
    // eligible tomorrow. Running these the other way round would make the
    // outcome depend on which sweep happened to go first, which is the accident
    // this ordering exists to remove.
    const streak = await runStreakGuardSweep({ db, now, userIds: streakCandidates });
    const resurface = await runResurfaceSweep({
      db,
      now,
      userIds: resurfaceCandidates,
      skipUserIds: streak.heldUserIds,
    });

    const dispatch = await dispatchPendingNotifications({ limit: DISPATCH_LIMIT }, db, now);

    return {
      ran: true as const,
      due: dueUsers.length,
      streak: { considered: streak.considered, held: streak.held },
      resurface,
      dispatch,
    };
  }, db, now).catch((error) => {
    // The one line below is the only report anyone gets that this ran at all,
    // so a thrown run must still produce it. Swallowing here also means the
    // endpoint answers 200 with a result rather than a 500 the caller might be
    // tempted to retry — the next tick is at most an hour away and every step
    // is idempotent, so there is nothing a retry recovers that waiting does not.
    failure = error instanceof Error ? error.message : String(error);
    return { ran: false as const };
  });

  const result: NotificationJobResult = outcome.ran ? outcome.result : SKIPPED;

  // One line per run, whatever happened. console.error rather than console.log
  // so it survives Render's default log level, matching services/usage.ts.
  console.error(JSON.stringify({
    event: "notifications_cron",
    ran: result.ran,
    due: result.due,
    considered: result.streak.considered + result.resurface.considered,
    queued: result.streak.held + result.resurface.queued,
    pending: result.dispatch.considered,
    sent: result.dispatch.sent,
    failed: result.dispatch.failed,
    // Quiet hours or the daily ceiling. These arrive in a later hour rather
    // than being lost, so a nonzero value here is normal, not an error.
    held: result.dispatch.held,
    // True means the kill switch is engaged and nothing transmitted.
    suppressed: result.dispatch.suppressed,
    ms: Date.now() - startedAt,
    ...(failure ? { error: failure } : {}),
  }));

  return result;
}
