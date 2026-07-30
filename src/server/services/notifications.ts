import {
  DevicePlatform,
  DeviceProvider,
  NotificationStatus,
  NotificationType,
  type Prisma,
} from "@prisma/client";
import { AppError } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/server/db";

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
  }

  throw new AppError("INVALID_NOTIFICATION_TYPE", "Unsupported notification type", 500);
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
export async function prepareNotificationPayloads(args: {
  notificationIds?: string[];
  recipientId?: string;
  limit?: number;
}, db: DbClient = prisma): Promise<PreparedPayload[]> {
  const notifications = await db.notification.findMany({
    where: {
      status: NotificationStatus.PENDING,
      ...(args.notificationIds?.length
        ? { id: { in: args.notificationIds } }
        : args.recipientId
          ? { recipientId: args.recipientId }
          : {}),
    },
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

  return notifications.flatMap((notification) =>
    notification.recipient.deviceTokens.map((deviceToken) => ({
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

export type DispatchResult = {
  /** Notification rows moved to SENT. */
  sent: number;
  /** Notification rows moved to FAILED (no live device, or Expo rejected). */
  failed: number;
  /** Device tokens deactivated because Expo says they no longer exist. */
  deactivatedTokens: number;
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
 */
export async function dispatchPendingNotifications(args: {
  notificationIds?: string[];
  recipientId?: string;
  limit?: number;
} = {}, db: DbClient = prisma): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: 0, deactivatedTokens: 0 };

  let payloads: PreparedPayload[];
  try {
    payloads = await prepareNotificationPayloads(args, db);
  } catch {
    return result;
  }

  // Which notifications had at least one live device? A row with none can never
  // be delivered, and leaving it PENDING means it either sits forever or lands
  // as a stale surprise weeks later when the user finally grants permission.
  const consideredIds = new Set<string>();
  const deliverableIds = new Set<string>();
  try {
    const considered = await db.notification.findMany({
      where: {
        status: NotificationStatus.PENDING,
        ...(args.notificationIds?.length
          ? { id: { in: args.notificationIds } }
          : args.recipientId
            ? { recipientId: args.recipientId }
            : {}),
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
      ...(args.limit ? { take: args.limit } : {}),
    });
    for (const row of considered) consideredIds.add(row.id);
  } catch {
    return result;
  }
  for (const p of payloads) deliverableIds.add(p.notificationId);

  const undeliverable = [...consideredIds].filter((id) => !deliverableIds.has(id));
  if (undeliverable.length > 0) {
    try {
      const { count } = await db.notification.updateMany({
        where: { id: { in: undeliverable }, status: NotificationStatus.PENDING },
        data: { status: NotificationStatus.FAILED },
      });
      result.failed += count;
    } catch {
      // Bookkeeping only — never let it sink the batch that can be delivered.
    }
  }

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
