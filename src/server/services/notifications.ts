import {
  DevicePlatform,
  DeviceProvider,
  NotificationStatus,
  NotificationType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";
import {
  byPriority,
  CEILING_WINDOW_MS,
  decideSend,
  pushDeliveryEnabled,
  toPushPolicy,
  type UserPushPolicy,
} from "@/server/services/notification-policy";

/**
 * Templated copy for a notification type.
 *
 * Social notifications are the only ones that genuinely belong here: their
 * entire content is "who did what", so it can be derived from the actor. The
 * other two families arrive with bespoke copy — a resurfacing push IS its copy,
 * and a streak push has to name a number this function cannot see.
 *
 * They still get cases, because a function that throws on five of ten enum
 * values is a trap: it survived only for as long as every caller happened to
 * pass its own title and body, and the first one that forgot would have taken
 * down the sweep rather than sending a slightly generic push. These fallbacks
 * are the honest, uninformative thing to say when the specific thing is
 * missing.
 */
function buildNotificationCopy(type: NotificationType, actorName: string | null | undefined, deepLink: string): {
  title: string;
  body: string;
  deepLink: string;
} {
  const subject = actorName ?? "Someone";

  switch (type) {
    case NotificationType.NEW_FOLLOW:
      return {
        title: `${subject} followed you`,
        body: `${subject} is now following your intellectual profile.`,
        deepLink,
      };
    case NotificationType.NEW_LIKE:
      return {
        title: `${subject} liked your review`,
        body: `${subject} liked one of your public reviews.`,
        deepLink,
      };
    case NotificationType.NEW_COMMENT:
      return {
        title: `${subject} commented on your review`,
        body: `${subject} added a comment to one of your reviews.`,
        deepLink,
      };
    case NotificationType.NEW_REPLY:
      return {
        title: `${subject} replied to your comment`,
        body: `${subject} replied in a discussion you joined.`,
        deepLink,
      };
    case NotificationType.RANKING_UPDATED:
      return {
        title: `${subject} updated a ranking`,
        body: `${subject} updated a ranking list you follow.`,
        deepLink,
      };

    // ── the resurfacing family ────────────────────────────────────────────────
    // Reached only if selection ever enqueues without its own copy. Each says
    // the true general shape of its tier without inventing a specific claim.
    case NotificationType.CONTRADICTION_FOUND:
      return {
        title: "two things you saved disagree",
        body: "see where they split.",
        deepLink,
      };
    case NotificationType.THREAD_MOMENTUM:
      return {
        title: "a thread is picking up",
        body: "you've been circling it all week.",
        deepLink,
      };
    case NotificationType.DORMANT_REVIVAL:
      return {
        title: "you left a thread unfinished",
        body: "nothing new in a while. it's still there.",
        deepLink,
      };
    case NotificationType.RESURFACE:
      return {
        title: "something you saved a while back",
        body: "does it still hold?",
        deepLink,
      };

    // ── the streak guard ──────────────────────────────────────────────────────
    // Present tense and conditional, matching services/streak.ts: the freeze
    // bridges yesterday, it does not finish the job. Past tense here would
    // become false the moment a second day is missed.
    case NotificationType.STREAK_HELD:
      return {
        title: "your streak is still alive",
        body: "you missed yesterday — we bridged it. capture today and the run holds.",
        deepLink,
      };
  }
}

export async function createNotification(args: {
  db?: DbClient;
  recipientId: string;
  actorId?: string;
  type: NotificationType;
  deepLink: string;
  payload?: Record<string, unknown>;
  /** Bespoke copy. Social notifications derive theirs from the actor's name,
   * but a resurfacing push IS its copy — "two things you saved about attention
   * disagree" can only be written where the actual material is in hand. When
   * supplied, the templated copy is bypassed entirely. */
  title?: string;
  body?: string;
}) {
  const db = args.db ?? prisma;
  const actor = args.actorId
    ? await db.user.findUnique({
        where: { id: args.actorId },
        select: { name: true, profile: { select: { displayName: true, handle: true } } },
      })
    : null;
  const actorName = actor?.profile?.displayName ?? actor?.name;
  const copy = args.title && args.body
    ? { title: args.title, body: args.body, deepLink: args.deepLink }
    : buildNotificationCopy(args.type, actorName, args.deepLink);

  return db.notification.create({
    data: {
      recipientId: args.recipientId,
      actorId: args.actorId,
      type: args.type,
      title: copy.title,
      body: copy.body,
      deepLink: copy.deepLink,
      payload: (args.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function registerDeviceToken(args: {
  userId: string;
  token: string;
  platform: "IOS" | "ANDROID" | "WEB";
  provider: "APNS" | "FCM" | "EXPO";
}, db: DbClient = prisma) {
  return db.deviceToken.upsert({
    where: {
      provider_token: {
        provider: args.provider,
        token: args.token,
      },
    },
    update: {
      userId: args.userId,
      platform: args.platform,
      isActive: true,
    },
    create: {
      userId: args.userId,
      token: args.token,
      platform: args.platform,
      provider: args.provider,
    },
  });
}

/** One message as Expo's push service wants it. */
type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  channelId: "default";
};

/** A row of `notifications` fanned out to one device. */
type PreparedPayload = {
  notificationId: string;
  userId: string;
  token: string;
  provider: DeviceProvider;
  platform: DevicePlatform;
  payload: {
    title: string;
    body: string;
    deepLink: string;
    data: Prisma.JsonValue;
  };
};

/** One PENDING notification with everything the policy gates need to judge it. */
type PendingNotification = {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  tokens: { token: string; provider: DeviceProvider; platform: DevicePlatform }[];
};

type DispatchScope = {
  notificationIds?: string[];
  recipientId?: string;
  limit?: number;
};

/** The `where` every query in this file shares, so scoping can't drift. */
function pendingWhere(args: DispatchScope): Prisma.NotificationWhereInput {
  return {
    status: NotificationStatus.PENDING,
    ...(args.notificationIds?.length
      ? { id: { in: args.notificationIds } }
      : args.recipientId
        ? { recipientId: args.recipientId }
        : {}),
  };
}

/**
 * Expo's ticket for one message. `status: "ok"` means Expo accepted it and
 * owns delivery from here; an error ticket names the reason, and
 * `DeviceNotRegistered` specifically means the token is dead for good (app
 * deleted, permissions revoked, token rotated).
 */
type ExpoPushTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
/** Expo's documented cap per request. Never send one-at-a-time. */
const EXPO_PUSH_BATCH_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 15_000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * POST one batch to Expo and return its tickets, positionally aligned with the
 * messages sent.
 *
 * Returns `null` — rather than throwing — when the whole batch fails (network
 * down, Expo 5xx, malformed response). A dead batch is not the same as a batch
 * of dead tokens: the notifications stay PENDING and the next drain retries
 * them, which is exactly what you want for a transient outage.
 */
async function sendExpoBatch(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[] | null> {
  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // Expo rejects gzip-less clients on large batches with a 400 otherwise.
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as { data?: ExpoPushTicket[] };
    if (!Array.isArray(json.data) || json.data.length !== messages.length) return null;
    return json.data;
  } catch {
    return null;
  }
}

/**
 * Fan PENDING notifications out to their recipients' active device tokens.
 *
 * Pure read + projection: it deliberately does NOT touch notification status,
 * so the caller decides what counts as sent. (This used to mark every row SENT
 * on the way out, which is how the app came to believe it had a working push
 * pipeline while transmitting nothing.)
 */
export async function loadPendingNotifications(
  args: DispatchScope,
  db: DbClient = prisma,
): Promise<PendingNotification[]> {
  const notifications = await db.notification.findMany({
    where: pendingWhere(args),
    include: {
      recipient: {
        include: {
          deviceTokens: {
            where: { isActive: true, provider: DeviceProvider.EXPO },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  return notifications.map((notification) => ({
    id: notification.id,
    recipientId: notification.recipientId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    deepLink: notification.deepLink,
    payload: notification.payload,
    createdAt: notification.createdAt,
    tokens: (notification.recipient?.deviceTokens ?? []).map((deviceToken) => ({
      token: deviceToken.token,
      provider: deviceToken.provider,
      platform: deviceToken.platform,
    })),
  }));
}

/** Fan a set of notifications out to one message per live device. */
function toPayloads(notifications: PendingNotification[]): PreparedPayload[] {
  return notifications.flatMap((notification) =>
    notification.tokens.map((deviceToken) => ({
      notificationId: notification.id,
      userId: notification.recipientId,
      token: deviceToken.token,
      provider: deviceToken.provider,
      platform: deviceToken.platform,
      payload: {
        title: notification.title,
        body: notification.body,
        deepLink: notification.deepLink,
        data: notification.payload,
      },
    })),
  );
}

export async function prepareNotificationPayloads(
  args: DispatchScope,
  db: DbClient = prisma,
): Promise<PreparedPayload[]> {
  return toPayloads(await loadPendingNotifications(args, db));
}

/**
 * Load each recipient's push policy in one read.
 *
 * A missing row is normal — most users never open settings — and resolves to
 * the permissive default rather than to silence.
 */
async function loadPolicies(
  recipientIds: string[],
  db: DbClient,
): Promise<Map<string, UserPushPolicy>> {
  const policies = new Map<string, UserPushPolicy>();
  try {
    const rows = await db.userPreference.findMany({
      where: { userId: { in: recipientIds } },
      select: {
        userId: true,
        tzOffsetMinutes: true,
        quietHoursStartHour: true,
        quietHoursEndHour: true,
        pushSocial: true,
        pushResurface: true,
        pushStreak: true,
      },
    });
    for (const row of rows) policies.set(row.userId, toPushPolicy(row));
  } catch {
    // Every user falls back to the default policy. Quiet hours degrade to UTC,
    // which is wrong for most people — but the alternative is either sending
    // nothing or ignoring quiet hours entirely, and both are worse.
  }
  return policies;
}

/**
 * How many pushes each recipient has actually received in the ceiling window.
 *
 * Counted from `sentAt`, not `createdAt`: the ceiling is about how much noise a
 * person experienced, and a notification queued on Monday but held through
 * quiet hours until Tuesday was Tuesday's noise.
 */
async function loadSentCounts(
  recipientIds: string[],
  db: DbClient,
  now: Date,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const rows = await db.notification.groupBy({
      by: ["recipientId"],
      where: {
        recipientId: { in: recipientIds },
        status: NotificationStatus.SENT,
        sentAt: { gte: new Date(now.getTime() - CEILING_WINDOW_MS) },
      },
      _count: { _all: true },
    });
    for (const row of rows) counts.set(row.recipientId, row._count._all);
  } catch {
    // Unknown means zero: a ceiling we cannot read must not become a silence we
    // cannot explain.
  }
  return counts;
}

export type DispatchResult = {
  /** PENDING rows this drain looked at. */
  considered: number;
  /** Notification rows moved to SENT. */
  sent: number;
  /** Notification rows moved to FAILED (no live device, opted out, stale, or
   * Expo rejected). */
  failed: number;
  /** Left PENDING on purpose — quiet hours or the daily ceiling. These are the
   * ones that arrive later, and the number to watch if pushes seem late. */
  held: number;
  /** Device tokens deactivated because Expo says they no longer exist. */
  deactivatedTokens: number;
  /** True when the kill switch suppressed this drain. */
  suppressed: boolean;
};

const EMPTY_RESULT: DispatchResult = {
  considered: 0,
  sent: 0,
  failed: 0,
  held: 0,
  deactivatedTokens: 0,
  suppressed: false,
};

/**
 * Drain PENDING notifications through Expo's push service.
 *
 * The contract this function exists to hold:
 *  - SENT only once Expo has actually accepted the message for that device.
 *  - FAILED (never silently SENT) when there is no live device or Expo
 *    rejects the message, so a stuck pipe is visible in the table.
 *  - PENDING is preserved on transient failure, so the next drain retries.
 *  - It never throws. Callers include the capture path and a cron-ish curl;
 *    neither should ever fall over because a push service had a bad minute.
 *
 * A note on "receipt": Expo's delivery receipts are a second, later round-trip
 * (`/push/getReceipts` against stored ticket ids). That needs a ticket table
 * and a second scheduled job to be worth anything. What we treat as the receipt
 * here is Expo's synchronous per-message ticket — the point at which delivery
 * stops being our responsibility and becomes APNs/FCM's. That is the strongest
 * signal available without standing up a second pipeline.
 *
 * Policy runs here rather than at queue time because all four gates are about
 * the moment of transmission, not the moment of authorship: what hour it is
 * where the user lives, how much they have already heard today, whether pushes
 * are switched on at all. A notification is written when there is something to
 * say and sent when it is a reasonable time to say it.
 *
 * Cost when idle: one query, no outbound request. Every later read is scoped to
 * recipients we actually found rows for, so an empty queue never reaches them.
 */
export async function dispatchPendingNotifications(args: {
  notificationIds?: string[];
  recipientId?: string;
  limit?: number;
} = {}, db: DbClient = prisma, now: Date = new Date()): Promise<DispatchResult> {
  const result: DispatchResult = { ...EMPTY_RESULT };

  // The kill switch, checked before anything is read. Rows in scope are moved
  // to a terminal status rather than left PENDING: the switch exists for the
  // case where the copy is wrong or the cron misfired, and in that case the
  // queue is exactly what you do NOT want delivered an hour later. One
  // statement, so an idle suppressed drain is as cheap as an idle one.
  if (!pushDeliveryEnabled()) {
    result.suppressed = true;
    try {
      const { count } = await db.notification.updateMany({
        where: pendingWhere(args),
        data: { status: NotificationStatus.FAILED },
      });
      result.considered = count;
      result.failed = count;
    } catch {
      // Nothing transmits either way, which is the property that matters.
    }
    return result;
  }

  let pending: PendingNotification[];
  try {
    pending = await loadPendingNotifications(args, db);
  } catch {
    return result;
  }

  result.considered = pending.length;
  if (pending.length === 0) return result;

  const recipientIds = [...new Set(pending.map((n) => n.recipientId))];
  const [policies, sentCounts] = await Promise.all([
    loadPolicies(recipientIds, db),
    loadSentCounts(recipientIds, db, now),
  ]);

  // Most perishable first, oldest first within a category. This is where
  // arbitration is enforced at the wire: when a user qualifies for a streak
  // push and a resurfacing push in the same drain and the ceiling only has room
  // for one, the streak one takes the slot and the other holds.
  const ordered = [...pending].sort((a, b) => {
    const priority = byPriority(a.type, b.type);
    return priority !== 0 ? priority : a.createdAt.getTime() - b.createdAt.getTime();
  });

  const sendable: PendingNotification[] = [];
  const dropIds: string[] = [];
  // Counts what this drain is about to add, so the ceiling accounts for the
  // messages in flight rather than only for history.
  const budget = new Map(recipientIds.map((id) => [id, sentCounts.get(id) ?? 0]));

  for (const notification of ordered) {
    const policy = policies.get(notification.recipientId) ?? toPushPolicy(null);
    const decision = decideSend({
      type: notification.type,
      createdAt: notification.createdAt,
      policy,
      sentInWindow: budget.get(notification.recipientId) ?? 0,
      now,
    });

    if (decision === "drop") {
      dropIds.push(notification.id);
      continue;
    }
    if (decision === "hold") {
      result.held += 1;
      continue;
    }

    // No live device: undeliverable forever, not merely inconvenient. Leaving it
    // PENDING means it either sits there or lands as a stale surprise weeks
    // later when the user finally grants permission. This is also the path a
    // STREAK_HELD takes for a user who declined push — the freeze itself was
    // already applied by the guard and is unaffected.
    if (notification.tokens.length === 0) {
      dropIds.push(notification.id);
      continue;
    }

    budget.set(notification.recipientId, (budget.get(notification.recipientId) ?? 0) + 1);
    sendable.push(notification);
  }

  if (dropIds.length > 0) {
    try {
      const { count } = await db.notification.updateMany({
        where: { id: { in: dropIds }, status: NotificationStatus.PENDING },
        data: { status: NotificationStatus.FAILED },
      });
      result.failed += count;
    } catch {
      // Bookkeeping only — never let it sink the batch that can be delivered.
    }
  }

  const payloads = toPayloads(sendable);
  if (payloads.length === 0) return result;

  // A notification counts as sent if ANY of the user's devices accepted it —
  // one dead iPad shouldn't mark a delivered push as failed.
  const acceptedNotificationIds = new Set<string>();
  const attemptedNotificationIds = new Set<string>();
  const deadTokens = new Set<string>();

  for (const batch of chunk(payloads, EXPO_PUSH_BATCH_SIZE)) {
    const messages: ExpoPushMessage[] = batch.map((p) => ({
      to: p.token,
      title: p.payload.title,
      body: p.payload.body,
      // The tap handler reads `deepLink` off this — see mobile/contexts/NotificationContext.
      data: {
        deepLink: p.payload.deepLink,
        notificationId: p.notificationId,
        ...(p.payload.data && typeof p.payload.data === "object" && !Array.isArray(p.payload.data)
          ? (p.payload.data as Record<string, unknown>)
          : {}),
      },
      sound: "default",
      channelId: "default",
    }));

    const tickets = await sendExpoBatch(messages);

    // Whole-batch failure: leave every row PENDING so the next drain retries.
    if (!tickets) continue;

    tickets.forEach((ticket, i) => {
      const p = batch[i];
      attemptedNotificationIds.add(p.notificationId);
      if (ticket.status === "ok") {
        acceptedNotificationIds.add(p.notificationId);
        return;
      }
      if (ticket.details?.error === "DeviceNotRegistered") deadTokens.add(p.token);
    });
  }

  if (deadTokens.size > 0) {
    try {
      const { count } = await db.deviceToken.updateMany({
        where: { token: { in: [...deadTokens] }, provider: DeviceProvider.EXPO },
        data: { isActive: false },
      });
      result.deactivatedTokens = count;
    } catch {
      // A token we failed to retire just gets retried and retired next drain.
    }
  }

  const sentIds = [...acceptedNotificationIds];
  if (sentIds.length > 0) {
    try {
      const { count } = await db.notification.updateMany({
        where: { id: { in: sentIds }, status: NotificationStatus.PENDING },
        data: { status: NotificationStatus.SENT, sentAt: new Date() },
      });
      result.sent += count;
    } catch {
      return result;
    }
  }

  // Attempted, every device rejected: a real failure, and it should read as one.
  const rejectedIds = [...attemptedNotificationIds].filter((id) => !acceptedNotificationIds.has(id));
  if (rejectedIds.length > 0) {
    try {
      const { count } = await db.notification.updateMany({
        where: { id: { in: rejectedIds }, status: NotificationStatus.PENDING },
        data: { status: NotificationStatus.FAILED },
      });
      result.failed += count;
    } catch {
      // Same as above: bookkeeping, not delivery.
    }
  }

  return result;
}
